const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'yyav';

async function createAdmin() {
    const client = new MongoClient(mongoUrl);
    try {
        await client.connect();
        const db = client.db(dbName);
        
        const username = 'zxc'; // 你想要的管理员用户名
        const password = 'Zxc200438'; // 你想要的密码，建议更复杂
        const hashedPassword = await bcrypt.hash(password, 10); // 加密密码

        await db.collection('admins').insertOne({
            username: username,
            password: hashedPassword,
            createdAt: new Date()
        });
        console.log(`管理员 ${username} 创建成功！`);
        console.log(`用户名: ${username}`);
        console.log(`密码: ${password}`);
    } catch (error) {
        console.error('创建管理员失败:', error);
    } finally {
        await client.close();
    }
}

createAdmin();