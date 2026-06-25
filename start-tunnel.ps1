while ($true) {
    Write-Host "Starting Node localtunnel manager..."
    node start-tunnel.js
    Write-Host "Node script exited. Restarting in 5 seconds..."
    Start-Sleep -Seconds 5
}
