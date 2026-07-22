export default class SkillManager {
    constructor(agent) {
        this.agent = agent;
        this.skills = new Map();
    }

    /**
     * Add a skill to the agent.
     * @param {Skill} skill 
     */
    addSkill(skill) {
        this.skills.set(skill.name, skill);
    }

    /**
     * Use a skill by name.
     * @param {string} skillName 
     * @param {Object} context 
     */
    useSkill(skillName, context) {
        const skill = this.skills.get(skillName);
        if (skill) {
            return skill.use({ agent: this.agent, ...context });
        }
        return false;
    }

    /**
     * Update all active skills.
     * @param {Object} context 
     * @param {number} delta 
     */
    update(context, delta) {
        this.skills.forEach(skill => {
            if (skill.isActive) {
                skill.update({ agent: this.agent, ...context }, delta);
            }
        });
    }
}
