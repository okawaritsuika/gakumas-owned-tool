"""Generate version.dll forwarders from this PC's actual Windows version.dll."""
from pathlib import Path
import json
import struct

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path('C:/Windows/System32/version.dll')
data = SOURCE.read_bytes()
u16 = lambda offset: struct.unpack_from('<H', data, offset)[0]
u32 = lambda offset: struct.unpack_from('<I', data, offset)[0]
pe = u32(0x3c)
optional = pe + 24
section_count, optional_size = u16(pe+6), u16(pe+20)
sections = [struct.unpack_from('<IIII', data, optional+optional_size+i*40+8) for i in range(section_count)]


def file_offset(rva):
    for virtual_size, virtual_address, raw_size, raw_pointer in sections:
        if virtual_address <= rva < virtual_address + max(virtual_size, raw_size):
            return raw_pointer + rva - virtual_address
    raise ValueError('Unmapped PE RVA')


directory = optional + (112 if u16(optional) == 0x20b else 96)
table = file_offset(u32(directory))
base, function_count, name_count = [u32(table+offset) for offset in [16,20,24]]
function_table, name_table, ordinal_table = [file_offset(u32(table+offset)) for offset in [28,32,36]]
exports = []
for index in range(name_count):
    start = file_offset(u32(name_table+index*4))
    name = data[start:data.index(0,start)].decode('ascii')
    exports.append((name, base+u16(ordinal_table+index*2)))
assert function_count == name_count, 'Ordinal-only exports need explicit forwarding support'
definition = 'LIBRARY version\nEXPORTS\n' + ''.join(
    f'    {name}=gakumas_inventory_system_version.{name} @{ordinal}\n' for name,ordinal in exports)
(ROOT/'collector/version.def').write_text(definition, encoding='ascii')
pragmas = '/* Windows version.dll forwards; never link against our own proxy. */\n' + ''.join(
    f'#pragma comment(linker, "/export:{name}=gakumas_inventory_system_version.{name},@{ordinal}")\n'
    for name, ordinal in exports)
(ROOT/'collector/version_forwarders.c').write_text(pragmas, encoding='ascii')
(ROOT/'collector/build').mkdir(parents=True,exist_ok=True)
(ROOT/'collector/build/system_version_exports.json').write_text(json.dumps(exports,indent=2),encoding='utf-8')
print(json.dumps({'forwarded_exports':len(exports),'system_dll':str(SOURCE)}))
