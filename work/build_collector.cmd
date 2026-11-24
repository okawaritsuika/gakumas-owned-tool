@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" > "work\compiler_environment.log" 2>&1
if errorlevel 1 exit /b %errorlevel%
cl /nologo /LD /O2 /MT /std:c11 /utf-8 /W3 /Focollector\build\ collector\collector.c collector\version_forwarders.c /link /OUT:collector\build\version.dll /IMPLIB:collector\build\collector.lib /PDB:collector\build\collector.pdb
exit /b %errorlevel%
