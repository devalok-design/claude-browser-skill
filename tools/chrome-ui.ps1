<#
.SYNOPSIS
  See and answer Chrome's own UI prompts (the bubbles under the URL bar: permission requests, save password,
  pop-up blocked, download warnings) that Playwright can't see, through Windows UI Automation.

.DESCRIPTION
  Chrome draws these prompts as small child windows of the browser window. They are not in the page DOM, so
  browser_snapshot and locators never see them, and in extension mode Browser.grantPermissions is refused.
  UI Automation exposes them with real buttons. This script only searches INSIDE those prompt windows, so it
  never clicks a page button that happens to have the same name.

.EXAMPLE
  powershell -File chrome-ui.ps1 -Profile agent-profile -List
  powershell -File chrome-ui.ps1 -Profile agent-profile -Window "permission.site" -Click Block
#>
param(
  [Parameter(Mandatory = $true)][string]$Profile,   # substring of the Chrome --user-data-dir to target
  [string]$Window = '',                              # substring of the browser window title (the page title)
  [string]$Click = '',                               # exact button label inside the prompt, e.g. Allow, Block, Never, Save
  [switch]$List
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [Windows.Automation.AutomationElement]; $S = [Windows.Automation.TreeScope]

$browser = Get-CimInstance Win32_Process -Filter "name='chrome.exe'" |
  Where-Object { $_.CommandLine -match [regex]::Escape($Profile) -and $_.CommandLine -notmatch '--type=' }
if (-not $browser) { throw "No Chrome browser process with '$Profile' in its command line." }
if (@($browser).Count -gt 1) { throw "More than one Chrome matches '$Profile'; be more specific." }

$tops = $A::RootElement.FindAll($S::Children, (New-Object Windows.Automation.PropertyCondition($A::ProcessIdProperty, [int]$browser.ProcessId))) |
  Where-Object { $_.Current.Name -like "*$Window*" }
$isWin = New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::Window)
$isBtn = New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::Button)

$prompts = foreach ($t in $tops) {
  foreach ($p in $t.FindAll($S::Descendants, $isWin)) {
    $label = $p.Current.Name
    if ($label -eq 'Infobar') {   # infobars are all named "Infobar"; their message is in Text children
      $label = 'Infobar: ' + (@($p.FindAll($S::Descendants, [Windows.Automation.Condition]::TrueCondition) |
        Where-Object { $_.Current.ControlType.ProgrammaticName -match 'Text' } | ForEach-Object { $_.Current.Name } | Select-Object -Unique) -join ' / ')
    }
    [pscustomobject]@{ Window = $t.Current.Name; Prompt = $label; Element = $p
                       Buttons = @($p.FindAll($S::Descendants, $isBtn) | ForEach-Object { $_.Current.Name }) }
  }
}

if ($List -or -not $Click) {
  if (-not $prompts) { 'No Chrome prompts open.'; exit 0 }
  $prompts | ForEach-Object { "[$($_.Window)]  prompt: '$($_.Prompt)'  buttons: $($_.Buttons -join ' | ')" }
  exit 0
}

$targets = @($prompts | Where-Object { $_.Buttons -contains $Click })
# The "<extension> started debugging this browser" infobar is how the Playwright extension holds the browser.
# Its Cancel detaches the debugger, which drops EVERY session using this browser. Never press it from here.
if ($Click -eq 'Cancel' -and ($targets | Where-Object { $_.Prompt -match 'started debugging this browser' })) {
  throw "Refusing: 'Cancel' on the 'started debugging this browser' infobar would disconnect every session on this browser."
}
if ($targets.Count -eq 0) { throw "No open prompt has a '$Click' button. Run with -List." }
if ($targets.Count -gt 1) { throw "Several prompts have a '$Click' button; narrow it with -Window. Run with -List." }
$btnCond = New-Object Windows.Automation.AndCondition($isBtn, (New-Object Windows.Automation.PropertyCondition($A::NameProperty, $Click)))
$targets[0].Element.FindFirst($S::Descendants, $btnCond).GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
"Clicked '$Click' on prompt '$($targets[0].Prompt)' in '$($targets[0].Window)'."
