export function resolveRevealTarget<T>(message: unknown, targets: Map<string, T>): [string, T] | undefined {
  if (!message || typeof message !== 'object') return undefined;
  if (!('type' in message) || message.type !== 'reveal-source' || !('id' in message) || typeof message.id !== 'string') return undefined;
  const target = targets.get(message.id);
  return target ? [message.id, target] : undefined;
}
