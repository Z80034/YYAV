const bcryptjs = require('bcryptjs');

async function hashPassword() {
    const password = 'admin123';
    const hashedPassword = await bcryptjs.hash(password, 10);
    console.log('Hashed Password:', hashedPassword);
}

hashPassword().catch(console.error);