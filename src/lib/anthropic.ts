/**
 * Shared Anthropic Client for tme-staff
 *
 * Singleton pattern for Anthropic client with timeout handling.
 */

import Anthropic from '@anthropic-ai/sdk';

let anthropicClient: Anthropic | null = null;

/**
 * Get the shared Anthropic client instance
 * Creates the client on first call (lazy initialization)
 */
export function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 60000, // 1 minute timeout
    });
  }
  return anthropicClient;
}

/**
 * Execute a promise with a timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 30000
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Request timeout after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeoutPromise]);
}
