import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createAppServer} from '../server.mjs';

test('shutdown rejects unrelated websites and non-JSON requests, then closes only its own server',async()=>{
  const server=createAppServer({catalog:{supportCards:[],idolCards:[]}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const post=(headers,body)=>fetch(base+'/api/shutdown',{method:'POST',headers,body});
  try{
    assert.equal((await post({'Content-Type':'application/json',Origin:'https://unrelated.example'},'{"appId":"gakumas-owned-tool"}')).status,403);
    assert.equal((await post({'Content-Type':'text/plain'},'{"appId":"gakumas-owned-tool"}')).status,400);
    assert.equal((await post({'Content-Type':'application/json'},'{"appId":"other-app"}')).status,400);
    assert.equal((await fetch(base+'/api/health')).status,200);
    const closed=once(server,'close');
    const response=await post({'Content-Type':'application/json'},'{"appId":"gakumas-owned-tool"}');
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,message:'보유노트를 종료했습니다.'});
    await closed;
    assert.equal(server.listening,false);
    await assert.rejects(fetch(base+'/api/health'));
  }finally{
    if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
});
