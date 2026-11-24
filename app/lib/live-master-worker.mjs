import { parentPort, workerData } from 'node:worker_threads';
import { fetchMasterUpdate, readMasterSnapshot, writeMasterSnapshot } from './live-master.mjs';

const { previousFile, stagedFile, names } = workerData;
const previous = readMasterSnapshot(previousFile, names);
const update = await fetchMasterUpdate({ previous, names });
if (update) writeMasterSnapshot(stagedFile, update);
parentPort.postMessage(Boolean(update));
