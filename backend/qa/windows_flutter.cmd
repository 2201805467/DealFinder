@echo off
rem QA fallback for an existing cached SDK when PowerShell bootstrap hangs.
rem No SDK files or machine configuration are modified.
"C:\flutter\bin\cache\dart-sdk\bin\dart.exe" "C:\flutter\bin\cache\flutter_tools.snapshot" %*
exit /b %errorlevel%
