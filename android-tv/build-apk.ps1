$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SdkDir = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$BuildTools = Join-Path $SdkDir 'build-tools\34.0.0'
$PlatformJar = Join-Path $SdkDir 'platforms\android-34\android.jar'
$JavaHome = 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'

$Aapt2 = Join-Path $BuildTools 'aapt2.exe'
$Aapt = Join-Path $BuildTools 'aapt.exe'
$D8 = Join-Path $BuildTools 'd8.bat'
$ZipAlign = Join-Path $BuildTools 'zipalign.exe'
$ApkSigner = Join-Path $BuildTools 'apksigner.bat'
$Javac = Join-Path $JavaHome 'bin\javac.exe'
$Keytool = Join-Path $JavaHome 'bin\keytool.exe'

foreach ($tool in @($Aapt2, $Aapt, $D8, $ZipAlign, $ApkSigner, $Javac, $Keytool, $PlatformJar)) {
    if (-not (Test-Path $tool)) {
        throw "Required tool or SDK file not found: $tool"
    }
}

# Use an ASCII temp directory because Windows aapt2 fails on non-ASCII paths.
$BuildDir = Join-Path ([System.IO.Path]::GetTempPath()) 'thousand-tv-build'
if (Test-Path $BuildDir) {
    Remove-Item -Path $BuildDir -Recurse -Force
}

$ResDir = Join-Path $BuildDir 'res'
$DrawableDir = Join-Path $ResDir 'drawable-nodpi'
$CompiledResDir = Join-Path $BuildDir 'compiled-res'
$GenDir = Join-Path $BuildDir 'gen'
$SrcCopyDir = Join-Path $BuildDir 'src'
$ClassesDir = Join-Path $BuildDir 'classes'
$DexDir = Join-Path $BuildDir 'dex'
$AssetsDir = Join-Path $BuildDir 'assets'

foreach ($d in @($DrawableDir, $CompiledResDir, $GenDir, $SrcCopyDir, $ClassesDir, $DexDir, $AssetsDir)) {
    New-Item -ItemType Directory -Path $d -Force | Out-Null
}

Copy-Item -Path (Join-Path $PSScriptRoot 'AndroidManifest.xml') -Destination (Join-Path $BuildDir 'AndroidManifest.xml') -Force
Copy-Item -Path (Join-Path $PSScriptRoot 'src\*') -Destination $SrcCopyDir -Recurse -Force

# 1. Generate 320x180 Android TV banner and copy launcher icon
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 320, 180
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$bgRect = New-Object System.Drawing.Rectangle 0, 0, 320, 180
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $bgRect,
    [System.Drawing.Color]::FromArgb(7, 71, 40),
    [System.Drawing.Color]::FromArgb(2, 26, 13),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
)
$g.FillRectangle($brush, $bgRect)

$goldPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(243, 200, 75), 4)
$g.DrawRectangle($goldPen, 8, 8, 304, 164)

$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center

$goldBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(243, 200, 75))
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$redBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 107, 125))
$darkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 0, 0, 0))

$fontBig = New-Object System.Drawing.Font('Segoe UI', 48, [System.Drawing.FontStyle]::Bold)
$fontSub = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$fontSuit = New-Object System.Drawing.Font('Segoe UI Symbol', 20, [System.Drawing.FontStyle]::Regular)

$titleText = -join ([char[]]@(0x0422, 0x042B, 0x0421, 0x042F, 0x0427, 0x0410))
$blackSuits = "$([char]0x2660)   $([char]0x2663)"
$redSuits = "$([char]0x2665)   $([char]0x2666)"

$g.DrawString('1000', $fontBig, $darkBrush, (New-Object System.Drawing.RectangleF 2, 16, 320, 82), $sf)
$g.DrawString('1000', $fontBig, $goldBrush, (New-Object System.Drawing.RectangleF 0, 14, 320, 82), $sf)
$g.DrawString($titleText, $fontSub, $whiteBrush, (New-Object System.Drawing.RectangleF 0, 96, 320, 34), $sf)
$g.DrawString($blackSuits, $fontSuit, $whiteBrush, (New-Object System.Drawing.RectangleF 36, 130, 120, 34), $sf)
$g.DrawString($redSuits, $fontSuit, $redBrush, (New-Object System.Drawing.RectangleF 164, 130, 120, 34), $sf)

$BannerPath = Join-Path $DrawableDir 'tv_banner.png'
$bmp.Save($BannerPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $goldPen.Dispose()
$goldBrush.Dispose(); $whiteBrush.Dispose(); $redBrush.Dispose(); $darkBrush.Dispose()
$fontBig.Dispose(); $fontSub.Dispose(); $fontSuit.Dispose(); $sf.Dispose()

Copy-Item -Path (Join-Path $ProjectRoot 'icons\icon-512.png') -Destination (Join-Path $DrawableDir 'ic_launcher.png') -Force

# 2. Compile and link Android resources with aapt2
& $Aapt2 compile --dir $ResDir -o (Join-Path $CompiledResDir 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

$UnalignedApk = Join-Path $BuildDir 'unaligned.apk'
& $Aapt2 link `
    -o $UnalignedApk `
    -I $PlatformJar `
    --manifest (Join-Path $BuildDir 'AndroidManifest.xml') `
    --java $GenDir `
    --min-sdk-version 21 `
    --target-sdk-version 34 `
    --auto-add-overlay `
    (Join-Path $CompiledResDir 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

# 3. Compile Java sources (MainActivity + generated R.java)
$JavaFiles = @(Get-ChildItem -Path $SrcCopyDir, $GenDir -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
& $Javac -encoding UTF-8 -source 1.8 -target 1.8 -bootclasspath $PlatformJar -d $ClassesDir @JavaFiles
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

# 4. Convert class files to DEX
$ClassFiles = @(Get-ChildItem -Path $ClassesDir -Recurse -Filter '*.class' | ForEach-Object { $_.FullName })
& $D8 --lib $PlatformJar --min-api 21 --output $DexDir @ClassFiles
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

# 5. Stage web assets and inject classes.dex + assets into APK
foreach ($f in @('index.html', 'style.css', 'engine.js', 'app.js', 'manifest.webmanifest')) {
    Copy-Item -Path (Join-Path $ProjectRoot $f) -Destination (Join-Path $AssetsDir $f) -Force
}
Copy-Item -Path (Join-Path $ProjectRoot 'cards') -Destination (Join-Path $AssetsDir 'cards') -Recurse -Force
$AssetsIconsDir = Join-Path $AssetsDir 'icons'
New-Item -ItemType Directory -Path $AssetsIconsDir -Force | Out-Null
foreach ($icon in @('icon-180.png', 'icon-192.png', 'icon-512.png')) {
    Copy-Item -Path (Join-Path $ProjectRoot "icons\$icon") -Destination (Join-Path $AssetsIconsDir $icon) -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($UnalignedApk, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $dexPath = Join-Path $DexDir 'classes.dex'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $dexPath, 'classes.dex', [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null

    $assetFiles = Get-ChildItem -Path $AssetsDir -Recurse -File
    foreach ($af in $assetFiles) {
        $rel = $af.FullName.Substring($AssetsDir.Length + 1).Replace('\', '/')
        $entryName = "assets/$rel"
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $af.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $zip.Dispose()
}

# 6. Align APK
$AlignedApk = Join-Path $BuildDir 'aligned.apk'
& $ZipAlign -f -p 4 $UnalignedApk $AlignedApk
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

# 7. Sign APK
$SavedKeystore = Join-Path $PSScriptRoot 'debug.keystore'
$WorkKeystore = Join-Path $BuildDir 'debug.keystore'
if (Test-Path $SavedKeystore) {
    Copy-Item -Path $SavedKeystore -Destination $WorkKeystore -Force
} else {
    & $Keytool -genkeypair -v `
        -keystore $WorkKeystore `
        -storepass android `
        -alias androiddebugkey `
        -keypass android `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -dname 'CN=Thousand1000,O=AndroidTV,C=RU'
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
    Copy-Item -Path $WorkKeystore -Destination $SavedKeystore -Force
}

$SignedTempApk = Join-Path $BuildDir 'signed.apk'
& $ApkSigner sign `
    --ks $WorkKeystore `
    --ks-pass pass:android `
    --ks-key-alias androiddebugkey `
    --key-pass pass:android `
    --out $SignedTempApk `
    $AlignedApk
if ($LASTEXITCODE -ne 0) { throw 'apksigner sign failed' }

$apkName = (-join ([char[]]@(0x0422, 0x044B, 0x0441, 0x044F, 0x0447, 0x0430))) + '-AndroidTV.apk'
$OutApk = Join-Path $ProjectRoot $apkName
Copy-Item -Path $SignedTempApk -Destination $OutApk -Force

Write-Output "APK built successfully: $OutApk"
