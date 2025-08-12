/**
 * Two-word name generator for cluster nodes
 * Generates human-friendly identifiers like "misty-owl", "brave-panda"
 */

/**
 * Curated list of adjectives for node names
 * Selected for clarity, uniqueness, and positive connotations
 */
const ADJECTIVES = [
  'ancient', 'azure', 'bold', 'brave', 'bright', 'calm', 'clever', 'cosmic',
  'crystal', 'dawn', 'deep', 'divine', 'dream', 'echo', 'elegant', 'ember',
  'epic', 'eternal', 'fabled', 'fierce', 'fire', 'frost', 'gentle', 'ghost',
  'giant', 'gold', 'grace', 'grand', 'great', 'green', 'happy', 'hidden',
  'holy', 'honor', 'iron', 'jade', 'light', 'live', 'lucky', 'lunar',
  'magic', 'mighty', 'misty', 'mystic', 'noble', 'ocean', 'prism', 'pure',
  'quick', 'quiet', 'rapid', 'royal', 'ruby', 'sage', 'shadow', 'sharp',
  'shiny', 'silent', 'silver', 'smart', 'solar', 'sonic', 'spark', 'spirit',
  'steel', 'storm', 'strong', 'swift', 'thunder', 'titan', 'true', 'twin',
  'ultra', 'vast', 'vivid', 'warm', 'white', 'wild', 'wise', 'young'
] as const;

/**
 * Curated list of animals for node names
 * Selected for variety, memorability, and positive associations
 */
const ANIMALS = [
  'ant', 'ape', 'bat', 'bear', 'bee', 'bird', 'bull', 'cat', 'cow', 'crab',
  'deer', 'dog', 'dove', 'duck', 'eagle', 'eel', 'elk', 'fish', 'fly', 'fox',
  'frog', 'goat', 'hawk', 'hen', 'horse', 'jay', 'kite', 'lamb', 'lion', 'lynx',
  'mole', 'moth', 'mouse', 'newt', 'owl', 'ox', 'panda', 'pig', 'pike', 'quail',
  'rabbit', 'ram', 'rat', 'raven', 'robin', 'seal', 'shark', 'sheep', 'snake', 'spider',
  'squid', 'stag', 'swan', 'tiger', 'toad', 'trout', 'turtle', 'viper', 'wasp', 'whale',
  'wolf', 'worm', 'wren', 'yak', 'zebra'
] as const;

/**
 * Two-word name generator utility
 */
export class TwoWordNameGenerator {
  /**
   * Generate a unique two-word identifier
   * @param existingNames Array of existing names to avoid collisions
   * @param maxAttempts Maximum attempts to find unique name
   * @returns Unique two-word identifier like "misty-owl"
   */
  static generate(existingNames: string[] = [], maxAttempts: number = 100): string {
    const existingSet = new Set(existingNames);
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
      const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
      const name = `${adjective}-${animal}`;
      
      if (!existingSet.has(name)) {
        return name;
      }
    }
    
    // Fallback: add random suffix if we can't find unique name
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${adjective}-${animal}-${randomSuffix}`;
  }
  
  /**
   * Generate multiple unique names at once
   * @param count Number of names to generate
   * @param existingNames Array of existing names to avoid collisions
   * @returns Array of unique two-word identifiers
   */
  static generateMultiple(count: number, existingNames: string[] = []): string[] {
    const results: string[] = [];
    const allExisting = new Set([...existingNames]);
    
    for (let i = 0; i < count; i++) {
      const name = this.generate([...allExisting]);
      results.push(name);
      allExisting.add(name);
    }
    
    return results;
  }
  
  /**
   * Validate that a name follows the two-word format
   * @param name Name to validate
   * @returns true if name is valid two-word format
   */
  static isValid(name: string): boolean {
    if (!name || typeof name !== 'string') {
      return false;
    }
    
    const parts = name.split('-');
    if (parts.length !== 2) {
      return false;
    }
    
    const [adjective, animal] = parts;
    return (
      ADJECTIVES.includes(adjective as any) &&
      ANIMALS.includes(animal as any)
    );
  }
  
  /**
   * Get total possible combinations
   * @returns Maximum number of unique names possible
   */
  static getMaxCombinations(): number {
    return ADJECTIVES.length * ANIMALS.length;
  }
  
  /**
   * Get usage statistics
   * @param existingNames Array of existing names
   * @returns Statistics about name usage
   */
  static getUsageStats(existingNames: string[] = []): {
    used: number;
    available: number;
    total: number;
    usagePercent: number;
  } {
    const total = this.getMaxCombinations();
    const used = existingNames.filter(name => this.isValid(name)).length;
    const available = total - used;
    const usagePercent = (used / total) * 100;
    
    return {
      used,
      available, 
      total,
      usagePercent: Math.round(usagePercent * 100) / 100
    };
  }
}