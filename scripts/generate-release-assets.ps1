$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$iconRoot = Join-Path $projectRoot "assets\icons"
$storeRoot = Join-Path $projectRoot "store-assets"

New-Item -ItemType Directory -Force -Path $iconRoot | Out-Null
New-Item -ItemType Directory -Force -Path $storeRoot | Out-Null

function New-Canvas {
  param(
    [int]$Width,
    [int]$Height,
    [scriptblock]$Draw
  )

  $bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  try {
    & $Draw $graphics $Width $Height
    return $bitmap
  }
  catch {
    $bitmap.Dispose()
    throw
  }
  finally {
    $graphics.Dispose()
  }
}

function Add-RoundedRectangle {
  param(
    [System.Drawing.Drawing2D.GraphicsPath]$Path,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $Path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $Path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $Path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $Path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $Path.CloseFigure()
}

function Draw-BalanceMark {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$X,
    [float]$Y,
    [float]$Size,
    [System.Drawing.Color]$Color
  )

  $lineWidth = [Math]::Max(1.2, $Size * 0.075)
  $pen = New-Object System.Drawing.Pen($Color, $lineWidth)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  try {
    $centerX = $X + ($Size / 2)
    $beamY = $Y + ($Size * 0.34)
    $leftX = $X + ($Size * 0.2)
    $rightX = $X + ($Size * 0.8)
    $panY = $Y + ($Size * 0.63)

    $Graphics.DrawLine($pen, $centerX, $Y + ($Size * 0.18), $centerX, $Y + ($Size * 0.78))
    $Graphics.DrawLine($pen, $X + ($Size * 0.13), $beamY, $X + ($Size * 0.87), $beamY)
    $Graphics.DrawLine($pen, $leftX, $beamY, $leftX - ($Size * 0.13), $panY)
    $Graphics.DrawLine($pen, $leftX, $beamY, $leftX + ($Size * 0.13), $panY)
    $Graphics.DrawLine($pen, $rightX, $beamY, $rightX - ($Size * 0.13), $panY)
    $Graphics.DrawLine($pen, $rightX, $beamY, $rightX + ($Size * 0.13), $panY)
    $Graphics.DrawArc($pen, $leftX - ($Size * 0.16), $panY - ($Size * 0.08), $Size * 0.32, $Size * 0.18, 0, 180)
    $Graphics.DrawArc($pen, $rightX - ($Size * 0.16), $panY - ($Size * 0.08), $Size * 0.32, $Size * 0.18, 0, 180)
    $Graphics.DrawLine($pen, $centerX - ($Size * 0.18), $Y + ($Size * 0.82), $centerX + ($Size * 0.18), $Y + ($Size * 0.82))
  }
  finally {
    $pen.Dispose()
  }
}

function Draw-Icon {
  param(
    [System.Drawing.Graphics]$Graphics,
    [int]$Width,
    [int]$Height
  )

  $Graphics.Clear([System.Drawing.Color]::Transparent)
  $padding = $Width * 0.125
  $side = $Width - ($padding * 2)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 87, 208))

  try {
    Add-RoundedRectangle $path $padding $padding $side $side ($side * 0.21)
    $Graphics.FillPath($brush, $path)
    Draw-BalanceMark $Graphics ($padding + ($side * 0.15)) ($padding + ($side * 0.12)) ($side * 0.7) ([System.Drawing.Color]::White)
  }
  finally {
    $brush.Dispose()
    $path.Dispose()
  }
}

foreach ($size in @(16, 32, 48, 96, 128)) {
  $icon = New-Canvas $size $size ${function:Draw-Icon}
  try {
    $icon.Save((Join-Path $iconRoot "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    if ($size -eq 128) {
      $icon.Save((Join-Path $storeRoot "icon-128.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    }
  }
  finally {
    $icon.Dispose()
  }
}

function Export-StoreScreenshot {
  param(
    [string]$Source,
    [string]$Destination
  )

  $sourceImage = [System.Drawing.Image]::FromFile($Source)
  try {
    $targetRatio = 1280.0 / 800.0
    $cropWidth = [int][Math]::Floor($sourceImage.Width * 0.75)
    $cropHeight = [int][Math]::Floor($cropWidth / $targetRatio)
    $cropX = $sourceImage.Width - $cropWidth

    $sourceRect = New-Object System.Drawing.Rectangle($cropX, 0, $cropWidth, $cropHeight)
    $destinationRect = New-Object System.Drawing.Rectangle(0, 0, 1280, 800)
    $output = New-Canvas 1280 800 {
      param($graphics, $width, $height)
      $graphics.DrawImage($sourceImage, $destinationRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
    }

    try {
      $output.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
      $output.Dispose()
    }
  }
  finally {
    $sourceImage.Dispose()
  }
}

Export-StoreScreenshot (Join-Path $projectRoot "Before.png") (Join-Path $storeRoot "01-before-1280x800.png")
Export-StoreScreenshot (Join-Path $projectRoot "After.png") (Join-Path $storeRoot "02-after-1280x800.png")

$promo = New-Canvas 440 280 {
  param($graphics, $width, $height)
  $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(0, 0, $width, $height)),
    [System.Drawing.Color]::FromArgb(255, 11, 87, 208),
    [System.Drawing.Color]::FromArgb(255, 21, 52, 95),
    18.0
  )
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $softBlue = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 232, 241, 255))
  $titleFont = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $priceFont = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

  try {
    $graphics.FillRectangle($background, 0, 0, $width, $height)
    Draw-BalanceMark $graphics 28 30 90 ([System.Drawing.Color]::White)
    $graphics.DrawString("Consistent Unit Price", $titleFont, $white, 135, 52)

    $leftPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $rightPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    try {
      Add-RoundedRectangle $leftPath 35 160 145 62 14
      Add-RoundedRectangle $rightPath 260 160 145 62 14
      $graphics.FillPath($softBlue, $leftPath)
      $graphics.FillPath($white, $rightPath)
    }
    finally {
      $leftPath.Dispose()
      $rightPath.Dispose()
    }

    $blueText = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 87, 208))
    $navyText = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 21, 52, 95))
    try {
      $graphics.DrawString("59.5 cents/oz", $priceFont, $navyText, 43, 178)
      $graphics.DrawString('$9.52/lb', $priceFont, $blueText, 294, 178)
      $arrowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 5)
      $arrowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
      $arrowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
      try {
        $graphics.DrawLine($arrowPen, 202, 191, 238, 191)
        $graphics.DrawLine($arrowPen, 228, 181, 238, 191)
        $graphics.DrawLine($arrowPen, 228, 201, 238, 191)
      }
      finally {
        $arrowPen.Dispose()
      }
    }
    finally {
      $blueText.Dispose()
      $navyText.Dispose()
    }
  }
  finally {
    $background.Dispose()
    $white.Dispose()
    $softBlue.Dispose()
    $titleFont.Dispose()
    $priceFont.Dispose()
  }
}

try {
  $promo.Save((Join-Path $storeRoot "promo-440x280.png"), [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $promo.Dispose()
}

Write-Output "Generated extension icons and store graphics."
