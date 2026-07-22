import * as THREE from 'three';

export default class MissionManager {
    constructor(scene, cityManager) {
        this.scene = scene;
        this.cityManager = cityManager;
        this.currentMission = 0;
        this.totalMissions = 3;
        this.targetsPerMission = 7;
        this.targets = [];
        this.targetMarkers = [];
        this.missionStats = [];
        this.penalizedBuildings = new Set();
        this.currentStats = {
            hits: 0,
            misses: 0,
            score: 0
        };
        this.gameOver = false;
    }

    // Inicializa a primeira missão
    init() {
        this.startMission();
    }

    // Escolhe alvos para a missão atual
    selectTargets() {
        this.targets = [];
        this.clearTargetMarkers();
        this.cityManager.buildings.forEach(b => { b.isTarget = false; });

        // Define tipos de alvos por missão
        let allowedTypes;
        switch (this.currentMission) {
            case 0: // Primeira missão: usinas e ETAs
                allowedTypes = ['powerPlant', 'waterPlant'];
                break;
            case 1: // Segunda missão: prédios
                allowedTypes = ['building', 'cityHall'];
                break;
            case 2: // Terceira missão: casas
                allowedTypes = ['house'];
                break;
            default:
                allowedTypes = ['house', 'powerPlant', 'waterPlant', 'building', 'cityHall'];
        }

        const availableBuildings = this.cityManager.buildings.filter(
            b => !b.destroyed && allowedTypes.includes(b.type)
        );

        const filteredBuildings = availableBuildings.filter((building) => {
            if (this.currentMission !== 1) return true;
            return Math.abs(building.position.x) > 35 || Math.abs(building.position.z) > 120;
        });

        const candidates = filteredBuildings.length >= this.targetsPerMission ? filteredBuildings : availableBuildings;

        for (let i = 0; i < this.targetsPerMission && candidates.length > 0; i++) {
            const index = Math.floor(Math.random() * candidates.length);
            const building = candidates[index];
            building.isTarget = true;
            this.targets.push(building);
            candidates.splice(index, 1);
            this.createTargetMarker(building);
        }
    }

    // Cria uma bolinha vermelha sobre o alvo
    createTargetMarker(building) {
        const markerGeometry = new THREE.SphereGeometry(0.6, 8, 8);
        const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false, depthWrite: false });
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.renderOrder = 999;
        const size = new THREE.Vector3();
        building.box.getSize(size);
        marker.position.copy(building.position);
        let extraY = 2;
        if (building.type === 'cityHall') extraY = size.y * 1.0 + 3;
        if (building.type === 'powerPlant') extraY = Math.max(extraY, size.y * 0.6 + 2);
        marker.position.y += size.y / 2 + extraY;
        marker.userData.building = building;
        this.scene.add(marker);
        this.targetMarkers.push(marker);
    }

    // Remove todos os marcadores de alvo
    clearTargetMarkers() {
        this.targetMarkers.forEach(marker => {
            this.scene.remove(marker);
        });
        this.targetMarkers = [];
    }

    // Verifica se um alvo foi completamente destruído e dá a pontuação
    checkTargetDestroyed(building) {
        const targetIndex = this.targets.findIndex(t => t === building);
        if (targetIndex !== -1) {
            this.currentStats.hits++;
            this.currentStats.score += 100; // 100 pontos por alvo destruído
            this.removeTarget(targetIndex);
            return true;
        }
        return false;
    }

    penalizeNonTarget(building) {
        if (!building || building.destroyed) return false;
        if (building.isTarget) return false;
        if (this.penalizedBuildings.has(building)) return false;
        this.penalizedBuildings.add(building);
        this.currentStats.misses++;
        this.currentStats.score = Math.max(0, this.currentStats.score - 50);
        return true;
    }

    // Remove um alvo da lista e seu marcador
    removeTarget(index) {
        const target = this.targets[index];
        this.targets.splice(index, 1);
        target.isTarget = false;

        // Remove o marcador
        const markerIndex = this.targetMarkers.findIndex(m => m.userData.building === target);
        if (markerIndex !== -1) {
            this.scene.remove(this.targetMarkers[markerIndex]);
            this.targetMarkers.splice(markerIndex, 1);
        }
    }

    // Registra um erro (acerto em prédio não alvo)
    registerMiss() {
        this.currentStats.misses++;
    }

    // Inicia uma nova missão
    startMission() {
        this.currentStats = {
            hits: 0,
            misses: 0,
            score: 0
        };
        this.penalizedBuildings = new Set();
        this.selectTargets();
    }

    // Finaliza a missão atual
    completeMission() {
        // Salva as estatísticas da missão
        this.missionStats.push({
            missionNumber: this.currentMission + 1,
            hits: this.currentStats.hits,
            misses: this.currentStats.misses,
            score: this.currentStats.score,
            targetsDestroyed: this.currentStats.hits,
            totalTargets: this.targetsPerMission
        });

        this.currentMission++;

        if (this.currentMission >= this.totalMissions) {
            this.gameOver = true;
        } else {
            this.startMission();
        }
    }

    // Verifica se a missão está completa
    isMissionComplete() {
        return this.targets.length === 0;
    }

    // Reseta todo o sistema de missões
    reset() {
        this.currentMission = 0;
        this.missionStats = [];
        this.clearTargetMarkers();
        this.cityManager.buildings.forEach(b => { b.isTarget = false; });
        this.targets = [];
        this.gameOver = false;
        this.startMission();
    }

    // Obtém as estatísticas totais
    getTotalStats() {
        let totalHits = 0;
        let totalMisses = 0;
        let totalScore = 0;

        this.missionStats.forEach(stats => {
            totalHits += stats.hits;
            totalMisses += stats.misses;
            totalScore += stats.score;
        });

        return {
            totalHits,
            totalMisses,
            totalScore,
            missions: this.missionStats
        };
    }
}
