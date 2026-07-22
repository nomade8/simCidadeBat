/**
 * Base class for all agent skills.
 * Skills are modular behaviors that can be attached to any agent (Enemy, Tank, Player).
 */
export default class Skill {
    constructor(name, cooldown = 1000) {
        this.name = name;
        this.cooldown = cooldown;
        this.lastUsed = 0;
        this.isActive = false;
    }

    /**
     * Check if the skill can be used.
     * @returns {boolean}
     */
    canUse() {
        const now = Date.now();
        return now - this.lastUsed >= this.cooldown;
    }

    /**
     * Executes the skill logic.
     * @param {Object} context - Data needed for the skill (e.g., agent, target, scene).
     */
    use(context) {
        if (!this.canUse()) return false;
        
        this.lastUsed = Date.now();
        this.isActive = true;
        
        this.execute(context);
        return true;
    }

    /**
     * Abstract method to be implemented by sub-classes.
     */
    execute(context) {
        console.warn(`Skill "${this.name}" has no implementation for execute().`);
    }

    /**
     * Update logic for the skill (e.g., for continuous effects).
     */
    update(context, delta) {
        // Optional implementation
    }
}
