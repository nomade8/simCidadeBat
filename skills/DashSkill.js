import Skill from './Skill.js';

export default class DashSkill extends Skill {
    constructor(cooldown = 5000) {
        super('Dash', cooldown);
        this.dashDuration = 200; // ms
        this.dashSpeed = 2;
    }

    execute({ agent }) {
        if (!agent) return;

        const mesh = agent.mesh || agent;
        const originalSpeed = agent.speed || 0.1;
        
        // Temporarily boost speed
        agent.speed = this.dashSpeed;
        
        console.log(`${agent.name || 'Agent'} is Dashing!`);

        setTimeout(() => {
            agent.speed = originalSpeed;
            this.isActive = false;
        }, this.dashDuration);
    }
}
