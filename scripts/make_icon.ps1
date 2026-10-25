Add-Type -AssemblyName System.Drawing

function Create-GameIcon {
    param([string]$path)

    $size = 256
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Dark background with rounded corners
    $w = $size - 16
    $rect = New-Object System.Drawing.Rectangle(8, 8, $w, $w)
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 7, 11, 22))
    
    $pathG = New-Object System.Drawing.Drawing2D.GraphicsPath
    $radius = 48
    $pathG.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
    $pathG.AddArc(($rect.Right - $radius), $rect.Y, $radius, $radius, 270, 90)
    $pathG.AddArc(($rect.Right - $radius), ($rect.Bottom - $radius), $radius, $radius, 0, 90)
    $pathG.AddArc($rect.X, ($rect.Bottom - $radius), $radius, $radius, 90, 90)
    $pathG.CloseFigure()

    $g.FillPath($bgBrush, $pathG)

    # Neon cyan outline
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 34, 211, 238), 6)
    $g.DrawPath($borderPen, $pathG)

    # Inner kinetic pulse / wave
    $cyanPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 34, 211, 238), 16)
    $cyanPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $cyanPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $cyanPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $pts = @(
        (New-Object System.Drawing.Point(52, 172)),
        (New-Object System.Drawing.Point(96, 76)),
        (New-Object System.Drawing.Point(128, 136)),
        (New-Object System.Drawing.Point(160, 76)),
        (New-Object System.Drawing.Point(204, 172))
    )
    $g.DrawLines($cyanPen, $pts)

    # Glowing magenta athlete dot / orb in center
    $orbBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 244, 114, 182))
    $g.FillEllipse($orbBrush, 114, 160, 28, 28)

    # Text "AR"
    $font = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Bold)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString("AR GAMES", $font, $textBrush, 128, 196, $sf)

    # Convert to icon
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $ms.ToArray()

    $fs = [System.IO.File]::Create($path)
    $bw = New-Object System.IO.BinaryWriter($fs)
    
    # ICONDIR
    $bw.Write([uint16]0) # Reserved
    $bw.Write([uint16]1) # Type (1 = ICO)
    $bw.Write([uint16]1) # Count (1 image)

    # ICONDIRENTRY
    $bw.Write([byte]0)   # Width (0 = 256)
    $bw.Write([byte]0)   # Height (0 = 256)
    $bw.Write([byte]0)   # ColorCount
    $bw.Write([byte]0)   # Reserved
    $bw.Write([uint16]1) # Planes
    $bw.Write([uint16]32)# BitCount
    $bw.Write([uint32]$pngBytes.Length) # BytesInRes
    $bw.Write([uint32]22) # ImageOffset (6 + 16 = 22)

    $bw.Write($pngBytes)
    $bw.Flush()
    $fs.Close()

    $g.Dispose()
    $bmp.Dispose()
}

Create-GameIcon -path "d:\my_codes\AR_Family_Games\app_icon.ico"
Write-Output "Created app_icon.ico successfully"
