export function getRandomSafePosition(minRadius, maxRadius, existingPositions, minDistance = 5) {
    for (let attempts = 0; attempts < 50; attempts++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = minRadius + Math.random() * (maxRadius - minRadius);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        let isSafe = true;
        for (const pos of existingPositions) {
            const distance = Math.sqrt((x - pos.x)**2 + (z - pos.z)**2);

            if (distance < minDistance) {
                isSafe = false;
                break;
            }
        }

        if (isSafe) return { x, z};
    }
}