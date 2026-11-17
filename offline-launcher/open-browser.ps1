$ErrorActionPreference = 'Stop'
$root = Join-Path (Split-Path -Parent $PSScriptRoot) 'web-dist'
$prefix = 'http://127.0.0.1:4173/'
$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)
$listener.Start()
Start-Process $prefix
Write-Host "F4 Studio browser mode is running at $prefix"
Write-Host 'Close this window to stop the local server.'

$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8';
  '.json' = 'application/json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpeg' = 'image/jpeg'; '.jpg' = 'image/jpeg';
  '.mp3' = 'audio/mpeg'; '.wav' = 'audio/wav'; '.mp4' = 'video/mp4'; '.wasm' = 'application/wasm'; '.ttf' = 'font/ttf';
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
    $candidate = [IO.Path]::GetFullPath((Join-Path $root $relative))
    $rootFull = [IO.Path]::GetFullPath($root)
    if (-not $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      $context.Response.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
    } else {
      $bytes = [IO.File]::ReadAllBytes($candidate)
      $extension = [IO.Path]::GetExtension($candidate).ToLowerInvariant()
      $context.Response.ContentType = if ($types.ContainsKey($extension)) { $types[$extension] } else { 'application/octet-stream' }
      $context.Response.Headers.Add('Cross-Origin-Opener-Policy', 'same-origin')
      $context.Response.Headers.Add('Cross-Origin-Embedder-Policy', 'require-corp')
    }
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
