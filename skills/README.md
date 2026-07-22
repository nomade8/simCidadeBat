# Sistema de Skills para Agentes

Este sistema permite adicionar habilidades modulares a qualquer agente do jogo (Inimigos, Tanques ou o Jogador).

## Como Usar

1. **Importe o SkillManager e as Skills:**
```javascript
import { SkillManager, ShootSkill, DashSkill } from './skills/index.js';
```

2. **Inicialize no seu Agente:**
```javascript
this.skillManager = new SkillManager(this);
this.skillManager.addSkill(new ShootSkill(2000)); // 2s de cooldown
this.skillManager.addSkill(new DashSkill(5000));  // 5s de cooldown
```

3. **Use as Skills no Loop de Update:**
```javascript
// Exemplo: Atirar se estiver perto do player
if (distancia < 20) {
    this.skillManager.useSkill('Shoot', {
        targetPos: player.position,
        scene: scene,
        bulletsArray: enemyBullets,
        color: 0xff0000
    });
}
```

## Criando Novas Skills

Basta criar um novo arquivo que herda de `Skill`:

```javascript
import Skill from './Skill.js';

export default class MinhaNovaSkill extends Skill {
    constructor() {
        super('NomeDaSkill', 1000); // cooldown em ms
    }

    execute(context) {
        // Lógica da habilidade aqui
    }
}
```
