# Copyright © 2026 Alen Pepa
# Read-only Windows inventory. Writes one new JSON report; no network, settings,
# host names, user names, serial numbers or device-unique identifiers are exported.
[CmdletBinding()]
param([string]$OutputPath = (Join-Path (Get-Location) ("aelvor-hardware-" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json')))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This collector requires Windows. Browser checks and manual budgets remain available on other platforms.' }
$warnings = New-Object 'System.Collections.Generic.List[string]'
$cpus = @()
try {
    $cpus = @(Get-CimInstance -ClassName Win32_Processor -Property Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors | ForEach-Object {
        [ordered]@{ name = ([string]$_.Name).Trim(); manufacturer = ([string]$_.Manufacturer).Trim(); cores = $(if ($_.NumberOfCores -gt 0) { [int]$_.NumberOfCores } else { $null }); logicalProcessors = $(if ($_.NumberOfLogicalProcessors -gt 0) { [int]$_.NumberOfLogicalProcessors } else { $null }) }
    })
} catch { $warnings.Add('cpu-unavailable') }
$installed = $null; $visible = $null; $available = $null
try {
    $modules = @(Get-CimInstance -ClassName Win32_PhysicalMemory -Property Capacity)
    if ($modules.Count -gt 0) {
        [uint64]$sum = 0; $complete = $true
        foreach ($module in $modules) { if ($null -eq $module.Capacity -or $module.Capacity -le 0) { $complete = $false } else { $sum += [uint64]$module.Capacity } }
        if ($complete -and $sum -gt 0) { $installed = $sum }
    }
} catch { $warnings.Add('ram-installed-unavailable') }
try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -Property TotalVisibleMemorySize,FreePhysicalMemory
    if ($os.TotalVisibleMemorySize -gt 0) { $visible = [uint64]$os.TotalVisibleMemorySize * 1024 }
    if ($null -ne $os.FreePhysicalMemory) { $available = [uint64]$os.FreePhysicalMemory * 1024 }
} catch { $warnings.Add('ram-visible-unavailable') }

$nativeCode = @'
// Copyright © 2026 Alen Pepa
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace Aelvor {
  public static class HardwareV1 {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Desc1 {
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
      public uint VendorId, DeviceId, SubSysId, Revision;
      public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
      public uint LuidLow; public int LuidHigh; public uint Flags;
    }
    public sealed class Adapter {
      public string Name; public uint VendorId; public ulong DedicatedBytes, SharedBytes; public bool Software;
    }
    [DllImport("dxgi.dll", ExactSpelling = true)]
    private static extern int CreateDXGIFactory1(ref Guid iid, out IntPtr factory);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int Enumerate(IntPtr factory, uint index, out IntPtr adapter);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int Describe(IntPtr adapter, out Desc1 description);
    private static T Method<T>(IntPtr instance, int slot) where T : class {
      if (instance == IntPtr.Zero) throw new InvalidOperationException("Missing DXGI interface");
      IntPtr table = Marshal.ReadIntPtr(instance);
      if (table == IntPtr.Zero) throw new InvalidOperationException("Missing DXGI method table");
      return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table, slot * IntPtr.Size), typeof(T));
    }
    public static Adapter[] Read() {
      if (IntPtr.Size != 8 || Marshal.SizeOf(typeof(Desc1)) != 312) throw new PlatformNotSupportedException("64-bit DXGI layout required");
      var result = new List<Adapter>();
      IntPtr factory = IntPtr.Zero;
      var iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
      try {
        Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref iid, out factory));
        // IUnknown + IDXGIObject + IDXGIFactory: EnumAdapters1 is slot 12.
        var enumerate = Method<Enumerate>(factory, 12);
        for (uint index = 0; index < 64; index++) {
          IntPtr adapter = IntPtr.Zero;
          int status = enumerate(factory, index, out adapter);
          if (status == unchecked((int)0x887A0002)) break;
          try {
            Marshal.ThrowExceptionForHR(status);
            // IUnknown + IDXGIObject + IDXGIAdapter: GetDesc1 is slot 10.
            Desc1 info; Marshal.ThrowExceptionForHR(Method<Describe>(adapter, 10)(adapter, out info));
            result.Add(new Adapter { Name = info.Description, VendorId = info.VendorId, DedicatedBytes = info.DedicatedVideoMemory.ToUInt64(), SharedBytes = info.SharedSystemMemory.ToUInt64(), Software = (info.Flags & 2) != 0 });
          } finally { if (adapter != IntPtr.Zero) Marshal.Release(adapter); }
        }
      } finally { if (factory != IntPtr.Zero) Marshal.Release(factory); }
      return result.ToArray();
    }
  }
}
'@
$gpus = New-Object 'System.Collections.Generic.List[object]'
if ([Environment]::Is64BitProcess) {
    try {
        if (-not ('Aelvor.HardwareV1' -as [type])) { Add-Type -TypeDefinition $nativeCode -ErrorAction Stop }
        foreach ($gpu in [Aelvor.HardwareV1]::Read()) {
            $vendor = switch ($gpu.VendorId) { 0x10de { 'nvidia' } 0x1002 { 'amd' } 0x8086 { 'intel' } default { 'unknown' } }
            $gpus.Add([ordered]@{ id = ('gpu-' + $gpus.Count); name = ([string]$gpu.Name).Trim(); vendor = $vendor; dedicatedBytes = $gpu.DedicatedBytes; sharedBytes = $gpu.SharedBytes; software = $gpu.Software; source = 'dxgi' })
        }
        if ($gpus.Count -eq 64) { $warnings.Add('gpu-list-truncated') }
    } catch { $warnings.Add('gpu-dxgi-unavailable') }
} else { $warnings.Add('gpu-dxgi-64bit-required') }
# CIM can list disabled/unavailable controllers absent from DXGI. Memory stays
# unknown for those entries; the 32-bit legacy memory property is never used.
try {
    $seen = New-Object 'System.Collections.Generic.Dictionary[string,int]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($gpu in $gpus) { $name = [string]$gpu.name; if ($seen.ContainsKey($name)) { $seen[$name]++ } else { $seen[$name] = 1 } }
    foreach ($gpu in @(Get-CimInstance -ClassName Win32_VideoController -Property Name)) {
        $name = ([string]$gpu.Name).Trim()
        if ($seen.ContainsKey($name) -and $seen[$name] -gt 0) { $seen[$name]--; continue }
        if ($gpus.Count -ge 64) { $warnings.Add('gpu-list-truncated'); break }
        $vendor = if ($name -match 'NVIDIA|GeForce|Quadro') { 'nvidia' } elseif ($name -match 'AMD|Radeon') { 'amd' } elseif ($name -match 'Intel') { 'intel' } else { 'unknown' }
        $gpus.Add([ordered]@{ id = ('gpu-' + $gpus.Count); name = $name; vendor = $vendor; dedicatedBytes = $null; sharedBytes = $null; software = $null; source = 'cim' })
    }
} catch { $warnings.Add('gpu-cim-unavailable') }
$report = [ordered]@{ format = 'aelvor-hardware'; version = 1; os = 'windows'; generatedAt = [DateTime]::UtcNow.ToString('o'); cpus = @($cpus); ram = [ordered]@{ installedBytes = $installed; visibleBytes = $visible; availableBytes = $available }; gpus = @($gpus.ToArray()); warnings = @($warnings.ToArray() | Select-Object -Unique) }
$json = $report | ConvertTo-Json -Depth 8
$path = [IO.Path]::GetFullPath($OutputPath)
$stream = New-Object IO.FileStream($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try { $writer = New-Object IO.StreamWriter($stream, (New-Object Text.UTF8Encoding($false))); try { $writer.Write($json) } finally { $writer.Dispose() } } finally { $stream.Dispose() }
Write-Output ('Hardware report created: ' + $path)
