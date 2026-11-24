@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" > "work\fixture_compiler_environment.log" 2>&1
if errorlevel 1 exit /b %errorlevel%
cl /nologo /LD /std:c11 /MT /O2 /W3 /utf-8 collector\tests\fake_gameassembly.c /Focollector\tests\build\fake_gameassembly.obj /link /OUT:collector\tests\build\GameAssembly.dll /IMPLIB:collector\tests\build\fake_gameassembly.lib
if errorlevel 1 exit /b %errorlevel%
cl /nologo /LD /std:c11 /MT /O2 /W3 /utf-8 collector\tests\fake_vuplex.c /Focollector\tests\build\fake_vuplex.obj /link /OUT:collector\tests\build\VuplexWebViewWindows.dll /IMPLIB:collector\tests\build\fake_vuplex.lib
if errorlevel 1 exit /b %errorlevel%
cl /nologo /std:c11 /MT /O2 /W3 /utf-8 collector\tests\fake_gakumas.c /Focollector\tests\build\fake_gakumas.obj /link /OUT:collector\tests\build\gakumas.exe
exit /b %errorlevel%
