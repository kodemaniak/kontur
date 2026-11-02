export function isSupportedHost(platform = process.platform, architecture = process.arch): boolean {
  return platform === 'linux' && architecture === 'x64';
}
