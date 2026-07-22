import * as THREE from 'three';

export const PLANE_SCALE = 0.30;

const _tempMatrix = new THREE.Matrix4();
const _hideMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

export function getPlanePartDefinitions(includeLandingGear = true) {
    const wingMaterial = new THREE.MeshStandardMaterial({
        color: '#fcfcfc',
        roughness: 1,
        metalness: 0
    });
    const tailFinMaterial = new THREE.MeshPhongMaterial({
        color: '#fcfcfc',
        flatShading: true
    });
    const wheelMaterial = new THREE.MeshPhongMaterial({ color: 0x333333, flatShading: true });
    const strutMaterial = new THREE.MeshPhongMaterial({ color: 0x777777, flatShading: true });

    const parts = [];

    const addPart = (name, geometry, material, transform = {}) => {
        const local = new THREE.Object3D();
        if (transform.position) local.position.copy(transform.position);
        if (transform.rotation) {
            if (transform.rotation.x !== undefined) local.rotation.x = transform.rotation.x;
            if (transform.rotation.y !== undefined) local.rotation.y = transform.rotation.y;
            if (transform.rotation.z !== undefined) local.rotation.z = transform.rotation.z;
        }
        if (transform.scale) local.scale.copy(transform.scale);
        local.updateMatrix();

        parts.push({
            name,
            geometry,
            material,
            localMatrix: local.matrix.clone(),
            castShadow: transform.castShadow !== false
        });
    };

    const fuselageGeometry = new THREE.CapsuleGeometry(0.5, 3, 4, 8);
    addPart(
        'fuselage',
        fuselageGeometry,
        new THREE.MeshPhongMaterial({ color: '#0e036b', flatShading: true }),
        { rotation: { x: Math.PI / 2 } }
    );

    addPart(
        'wings',
        new THREE.CylinderGeometry(1, 1, 1.5, 32),
        wingMaterial,
        {
            position: new THREE.Vector3(0, 0.01, 0),
            scale: new THREE.Vector3(3.28678, 0.081655, 0.8)
        }
    );

    addPart(
        'tailFin',
        new THREE.BoxGeometry(0.1, 1, 1),
        tailFinMaterial,
        { position: new THREE.Vector3(0, 0.75, -1.5) }
    );

    addPart(
        'tailPlane',
        new THREE.BoxGeometry(2.3, 0.1, 0.8),
        wingMaterial,
        { position: new THREE.Vector3(0, 0, -1.6) }
    );

    if (includeLandingGear) {
        // Adiciona rodas e trem de pouso só quando necessário
        const rearWheelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.15, 16);
        addPart(
            'rearWheel',
            rearWheelGeometry,
            wheelMaterial,
            {
                position: new THREE.Vector3(0, -0.7, -1.8),
                rotation: { z: Math.PI / 2 }
            }
        );

        addPart(
            'rearStrut',
            new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8),
            strutMaterial,
            { position: new THREE.Vector3(0, -0.6, -1.8) }
        );

        const frontWheelGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16);
        const frontStrutGeometry = new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8);
        const frontWheelOffset = 2.0;

        addPart(
            'frontWheelLeft',
            frontWheelGeometry,
            wheelMaterial,
            {
                position: new THREE.Vector3(-frontWheelOffset, -0.6, 0.5),
                rotation: { z: Math.PI / 2 }
            }
        );
        addPart(
            'frontStrutLeft',
            frontStrutGeometry,
            strutMaterial,
            { position: new THREE.Vector3(-frontWheelOffset, -0.3, 0.5) }
        );
        addPart(
            'frontWheelRight',
            frontWheelGeometry.clone(),
            wheelMaterial,
            {
                position: new THREE.Vector3(frontWheelOffset, -0.6, 0.5),
                rotation: { z: Math.PI / 2 }
            }
        );
        addPart(
            'frontStrutRight',
            frontStrutGeometry.clone(),
            strutMaterial,
            { position: new THREE.Vector3(frontWheelOffset, -0.3, 0.5) }
        );
    }

    return parts;
}

export function createPlayerPlane(scene, fuselageColor = '#0e036b') {
    const airplane = new THREE.Group();
    const parts = getPlanePartDefinitions(true);

    parts.forEach((part) => {
        const material = part.name === 'fuselage'
            ? part.material.clone()
            : part.material;

        if (part.name === 'fuselage') {
            material.color.set(fuselageColor);
        }

        const mesh = new THREE.Mesh(part.geometry, material);
        mesh.matrix.copy(part.localMatrix);
        mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
        mesh.castShadow = part.castShadow;
        mesh.receiveShadow = false; // Desativa receiveShadow para evitar artefatos (triângulos) nas asas
        airplane.add(mesh);
    });

    airplane.scale.setScalar(PLANE_SCALE);
    scene.add(airplane);
    return airplane;
}

export function createEnemyInstancedPlanes(scene, maxEnemies) {
    const parts = getPlanePartDefinitions(false);
    const instancedMeshes = {};
    const dummyRoot = new THREE.Object3D();
    dummyRoot.scale.setScalar(PLANE_SCALE);

    parts.forEach((part) => {
        const material = part.material.clone();
        if (part.name === 'fuselage') {
            material.color.set('#cc0000');
        }

        const mesh = new THREE.InstancedMesh(part.geometry, material, maxEnemies);
        mesh.castShadow = part.castShadow;
        mesh.receiveShadow = false; // Desativa receiveShadow para evitar artefatos nas asas
        mesh.frustumCulled = false;

        for (let i = 0; i < maxEnemies; i++) {
            mesh.setMatrixAt(i, _hideMatrix);
        }
        mesh.instanceMatrix.needsUpdate = true;

        scene.add(mesh);
        instancedMeshes[part.name] = { mesh, localMatrix: part.localMatrix };
    });

    return { instancedMeshes, dummyRoot };
}

export function updateEnemyInstance(instancedMeshes, dummyRoot, instanceIndex, position, rotation) {
    dummyRoot.position.copy(position);
    dummyRoot.rotation.copy(rotation);
    dummyRoot.updateMatrix();

    Object.values(instancedMeshes).forEach(({ mesh, localMatrix }) => {
        _tempMatrix.multiplyMatrices(dummyRoot.matrix, localMatrix);
        mesh.setMatrixAt(instanceIndex, _tempMatrix);
    });
}

export function hideEnemyInstance(instancedMeshes, instanceIndex) {
    Object.values(instancedMeshes).forEach(({ mesh }) => {
        mesh.setMatrixAt(instanceIndex, _hideMatrix);
    });
}

export function markEnemyInstancesDirty(instancedMeshes) {
    Object.values(instancedMeshes).forEach(({ mesh }) => {
        mesh.instanceMatrix.needsUpdate = true;
    });
}

export function getEnemyBoundingBox(position, target = new THREE.Box3()) {
    const halfSize = new THREE.Vector3(1.2, 0.6, 1.5).multiplyScalar(PLANE_SCALE);
    target.setFromCenterAndSize(position, halfSize.multiplyScalar(2));
    return target;
}
