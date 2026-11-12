' Starts the GDS HR website and its Cloudflare tunnel (hidden, restarted if they stop).
' Copy this file into the Windows Startup folder (Win+R, type shell:startup) so it runs at sign-in.
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\L.Erika\Desktop\MY PROJECTS\gds-hr\scripts\start-online.ps1""", 0, False
