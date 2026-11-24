@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" > "work\thread_stack_environment.log" 2>&1
if errorlevel 1 exit /b %errorlevel%
cl /nologo /O2 /MT /W3 /utf-8 collector\tests\thread_stack_host.c /Fework\thread_stack_host.exe /Fowork\thread_stack_host.obj
exit /b %errorlevel%
