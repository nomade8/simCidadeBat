import * as THREE from 'three';

// Gerador de Ruído Simplex 2D rápido para texturas procedurais
function createNoise2D(seed = 1) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed;
    for (let i = 255; i > 0; i--) {
        s = (s * 16807 + 11) % 2147483647;
        const j = Math.floor((s / 2147483647) * (i + 1));
        const temp = p[i];
        p[i] = p[j];
        p[j] = temp;
    }
    const perm = new Uint8Array(512);
    const permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
        perm[i] = p[i & 255];
        permMod12[i] = perm[i] % 12;
    }
    const grad3 = [
        [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
        [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
        [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
    ];
    return function(xin, yin) {
        let n0, n1, n2;
        const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
        const t = (i + j) * G2;
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = xin - X0;
        const y0 = yin - Y0;
        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1.0 + 2.0 * G2;
        const y2 = y0 - 1.0 + 2.0 * G2;
        const ii = i & 255;
        const jj = j & 255;
        const gi0 = permMod12[ii + perm[jj]];
        const gi1 = permMod12[ii + i1 + perm[jj + j1]];
        const gi2 = permMod12[ii + 1 + perm[jj + 1]];
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 < 0) n0 = 0.0;
        else { t0 *= t0; n0 = t0 * t0 * (grad3[gi0][0] * x0 + grad3[gi0][1] * y0); }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 < 0) n1 = 0.0;
        else { t1 *= t1; n1 = t1 * t1 * (grad3[gi1][0] * x1 + grad3[gi1][1] * y1); }
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 < 0) n2 = 0.0;
        else { t2 *= t2; n2 = t2 * t2 * (grad3[gi2][0] * x2 + grad3[gi2][1] * y2); }
        return 70.0 * (n0 + n1 + n2);
    };
}

function fbm(noiseFn, x, y, octaves = 4) {
    let val = 0;
    let amp = 0.5;
    let freq = 1.0;
    for (let o = 0; o < octaves; o++) {
        val += amp * noiseFn(x * freq, y * freq);
        freq *= 2.0;
        amp *= 0.5;
    }
    return val;
}

export default class CraterManager {
    constructor(scene, ground) {
        this.scene = scene;
        this.ground = ground;
        this.sharedGeometry = new THREE.PlaneGeometry(1, 1);
        this.craterMaterials = [];
        this.craterCount = 0;
        this._pregenerateMaterials();
    }

    _pregenerateMaterials() {
        const size = 512;
        const seeds = [1337, 4242, 8888, 9999];

        seeds.forEach((seed, index) => {
            const { diffuseCanvas, bumpCanvas } = this._generateCraterTextures(size, seed);

            const texture = new THREE.CanvasTexture(diffuseCanvas);
            texture.flipY = false;
            texture.needsUpdate = true;
            texture.minFilter = THREE.LinearMipMapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.anisotropy = 8;

            const bumpTex = new THREE.CanvasTexture(bumpCanvas);
            bumpTex.flipY = false;
            bumpTex.needsUpdate = true;
            bumpTex.minFilter = THREE.LinearMipMapLinearFilter;
            bumpTex.magFilter = THREE.LinearFilter;

            const mat = new THREE.MeshStandardMaterial({
                map: texture,
                bumpMap: bumpTex,
                bumpScale: 0.45,
                transparent: true,
                alphaTest: 0.005,
                depthWrite: false, // Impede mascaramento de depth durante o pouso
                depthTest: true,
                roughness: 0.95,
                metalness: 0.05,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -3 - index,
                polygonOffsetUnits: -1
            });

            this.craterMaterials.push(mat);
        });
    }

    _generateCraterTextures(size = 512, seed = 1234) {
        const diffuseCanvas = document.createElement('canvas');
        diffuseCanvas.width = size;
        diffuseCanvas.height = size;
        const dCtx = diffuseCanvas.getContext('2d');
        const dImg = dCtx.createImageData(size, size);

        const bumpCanvas = document.createElement('canvas');
        bumpCanvas.width = size;
        bumpCanvas.height = size;
        const bCtx = bumpCanvas.getContext('2d');
        const bImg = bCtx.createImageData(size, size);

        const noiseMain = createNoise2D(seed);
        const noiseDetail = createNoise2D(seed + 555);
        const noiseCracks = createNoise2D(seed + 999);

        const cx = size / 2;
        const cy = size / 2;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const dx = (x - cx) / cx;
                const dy = (y - cy) / cy;
                const rRaw = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx);

                const nRadial = fbm(noiseMain, dx * 2.5, dy * 2.5, 4);
                const nRays = fbm(noiseDetail, angle * 3.5, rRaw * 5.0, 3);
                const rDistort = rRaw + nRadial * 0.12 + nRays * 0.08;

                const crackVal = Math.abs(fbm(noiseCracks, dx * 7.0, dy * 7.0, 3));
                const isCrack = crackVal < 0.04 && rDistort < 0.75;

                let rCol, gCol, bCol, alpha;
                let bumpHeight = 128;

                const coreMask = Math.max(0, 1 - Math.pow(rDistort / 0.4, 2));
                const scorchMask = Math.exp(-Math.pow((rDistort - 0.45) * 4.0, 2));
                const rimMask = Math.exp(-Math.pow((rDistort - 0.72) * 5.5, 2));
                const outerSmokeMask = Math.exp(-Math.pow((rDistort - 0.90) * 3.5, 2));

                const nMicro = fbm(noiseDetail, dx * 10, dy * 10, 3);

                if (isCrack) {
                    rCol = 10; gCol = 8; bCol = 7;
                    alpha = 245;
                    bumpHeight = 30;
                } else {
                    const cCore = [14, 11, 10];
                    const cScorch = [50, 34, 22];
                    const cRim = [125, 98, 70];
                    const cSmoke = [25, 22, 20];

                    const wCore = coreMask * 0.95;
                    const wScorch = scorchMask * 0.8;
                    const wRim = rimMask * 0.85;
                    const wSmoke = outerSmokeMask * 0.5;

                    let totalW = wCore + wScorch + wRim + wSmoke;
                    if (totalW < 0.001) totalW = 1;

                    rCol = (cCore[0] * wCore + cScorch[0] * wScorch + cRim[0] * wRim + cSmoke[0] * wSmoke) / totalW;
                    gCol = (cCore[1] * wCore + cScorch[1] * wScorch + cRim[1] * wRim + cSmoke[1] * wSmoke) / totalW;
                    bCol = (cCore[2] * wCore + cScorch[2] * wScorch + cRim[2] * wRim + cSmoke[2] * wSmoke) / totalW;

                    rCol += nMicro * 20;
                    gCol += nMicro * 16;
                    bCol += nMicro * 12;

                    const falloff = 1 - smoothstep(0.55, 0.98, rDistort);
                    alpha = Math.floor(255 * falloff);

                    const depthFactor = -coreMask * 90;
                    const rimFactor = rimMask * 60;
                    const microFactor = nMicro * 30;
                    bumpHeight = Math.max(0, Math.min(255, 128 + depthFactor + rimFactor + microFactor));
                }

                dImg.data[i]     = clamp(rCol, 0, 255);
                dImg.data[i + 1] = clamp(gCol, 0, 255);
                dImg.data[i + 2] = clamp(bCol, 0, 255);
                dImg.data[i + 3] = clamp(alpha, 0, 255);

                const bVal = clamp(bumpHeight, 0, 255);
                bImg.data[i]     = bVal;
                bImg.data[i + 1] = bVal;
                bImg.data[i + 2] = bVal;
                bImg.data[i + 3] = 255;
            }
        }

        dCtx.putImageData(dImg, 0, 0);
        bCtx.putImageData(bImg, 0, 0);

        return { diffuseCanvas, bumpCanvas };

        function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
        function smoothstep(a, b, v) {
            const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
            return t * t * (3 - 2 * t);
        }
    }

    createCrater(worldPos, radius = 5) {
        if (!this.scene || this.craterMaterials.length === 0) return;

        this.craterCount++;

        const mat = this.craterMaterials[Math.floor(Math.random() * this.craterMaterials.length)];

        const mesh = new THREE.Mesh(this.sharedGeometry, mat);
        mesh.scale.set(radius * 2, radius * 2, 1);
        mesh.rotation.x = -Math.PI / 2;

        // Sempre faz o Raycast a partir do alto (Y = 500) mirando para baixo para encontrar a superfície do solo/rua
        let surfaceY = 0;
        const ray = new THREE.Raycaster(
            new THREE.Vector3(worldPos.x, 500, worldPos.z),
            new THREE.Vector3(0, -1, 0)
        );

        // 1. Raycast no terreno principal (ground)
        if (this.ground) {
            const hits = ray.intersectObject(this.ground, true);
            if (hits.length > 0) {
                surfaceY = hits[0].point.y;
            }
        }

        // 2. Raycast para ruas ou pista (superfícies baixas perto do solo, ignorando telhados de prédios)
        if (this.scene) {
            const hits = ray.intersectObjects(this.scene.children, true);
            for (let i = 0; i < hits.length; i++) {
                const hitObj = hits[i].object;
                if (hitObj.isMesh && hitObj !== this.ground && !hitObj.userData?.isCrater && hitObj !== mesh) {
                    // Pistas e ruas ficam na altura do solo (y < 1.0)
                    if (hits[i].point.y < 1.0 && hits[i].point.y >= surfaceY) {
                        surfaceY = hits[i].point.y;
                        break;
                    }
                }
            }
        }

        // Camada progressiva sutil para evitar Z-fighting entre crateras sobrepostas
        const layerIndex = this.craterCount % 500;
        const yOffset = 0.015 + layerIndex * 0.0002;
        mesh.position.set(worldPos.x, surfaceY + yOffset, worldPos.z);

        mesh.rotation.z = Math.random() * Math.PI * 2;
        mesh.receiveShadow = true;
        mesh.renderOrder = 20 + layerIndex;
        mesh.frustumCulled = false;
        mesh.userData.isCrater = true;

        this.scene.add(mesh);
        return mesh;
    }
}
