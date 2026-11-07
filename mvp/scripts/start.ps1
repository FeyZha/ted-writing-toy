param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$appRoot = Split-Path -Parent $PSScriptRoot
$url = 'http://127.0.0.1:4397'
function Show-Failure([string]$Text) {
    [System.Windows.Forms.MessageBox]::Show($Text, '英语写作练习', 'OK', 'Warning') | Out-Null
}
function Test-OwnServer {
    try {
        $meta = Invoke-RestMethod -Uri ($url + '/api/health') -TimeoutSec 1
        return $meta.id -eq 'english-writing-mvp' -and $meta.apiVersion -eq 1 -and $meta.features -contains 'ted-import'
    } catch { return $false }
}
try {
    if (-not (Test-OwnServer)) {
        if (Get-NetTCPConnection -State Listen -LocalPort 4397 -ErrorAction SilentlyContinue) {
            Show-Failure '练习工具的本机端口被其他程序占用。请关闭占用程序后重试，或联系我处理；已保存的草稿不会被清除。'
            exit 1
        }
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($null -eq $nodeCommand) { Show-Failure '没有找到运行工具所需的 Node.js。请联系我补齐运行环境，无需自己输入命令。'; exit 1 }
        if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'dist\index.html'))) { Show-Failure '没有找到完整的程序文件，请联系我重新准备。'; exit 1 }
        $runtimeFolder = Join-Path $appRoot '.runtime'
        [System.IO.Directory]::CreateDirectory($runtimeFolder) | Out-Null
        $serverFile = Join-Path $PSScriptRoot 'server.mjs'
        $serverArguments = '"' + $serverFile + '"'
        $child = Start-Process -FilePath $nodeCommand.Source -ArgumentList $serverArguments -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeFolder 'server.log') -RedirectStandardError (Join-Path $runtimeFolder 'server-error.log')
        [System.IO.File]::WriteAllText((Join-Path $runtimeFolder 'server.pid'), [string]$child.Id)
        $ready = $false
        for ($attempt = 0; $attempt -lt 15; $attempt++) {
            if (Test-OwnServer) { $ready = $true; break }
            if ($child.HasExited) { break }
            Start-Sleep -Milliseconds 150
        }
        if (-not $ready) { Show-Failure '练习工具暂时没有启动成功。请把这个情况告诉我，我来处理。'; exit 1 }
    }
    if (-not $NoOpen) { Start-Process $url }
} catch { Show-Failure ('启动时遇到问题：' + $_.Exception.Message); exit 1 }
