const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

// 初始化 Express
const app = express();

// 从环境变量获取 MongoDB 连接字符串和端口
const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
const dbName = 'yyav';
const port = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || origin.startsWith('http://localhost') || origin.includes('onrender.com')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// 提供静态文件（HTML、CSS、JS 等）
app.use(express.static(path.join(__dirname, '.')));

// 提供视频和图片的静态文件访问（临时方案，建议使用云存储）
app.use('/videos', express.static(path.join(__dirname, 'videos')), (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    next();
});
app.use('/images', express.static(path.join(__dirname, 'images')));

// 配置 multer 用于文件上传（临时存储，建议使用云存储）
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'videos/');
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

// MongoDB 连接
let db;
const client = new MongoClient(mongoUrl, { connectTimeoutMS: 5000 });

async function connectToMongo() {
    try {
        console.log('尝试连接 MongoDB:', mongoUrl.replace(/\/\/.*@/, '//<hidden>@'));
        await client.connect();
        console.log('✅ MongoDB 连接成功');
        await client.db(dbName).command({ ping: 1 });
        console.log('✅ MongoDB ping 成功');
        db = client.db(dbName);
        console.log('当前数据库:', db.databaseName);
        const videoCount = await db.collection('videos').countDocuments();
        console.log(`videos 集合中有 ${videoCount} 条数据`);
    } catch (error) {
        console.error('❌ MongoDB 连接失败:', error.message);
        throw error;
    }
}

connectToMongo().catch(error => {
    console.error('初始化 MongoDB 连接失败:', error.message);
    process.exit(1);
});

// 验证 token 的中间件
function verifyToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: '未提供 token' });
    }
    try {
        const decoded = jwt.verify(token, 'your_jwt_secret');
        if (decoded.role !== 'admin') {
            return res.status(403).json({ message: '无权限，仅限管理员' });
        }
        req.user = decoded;
        next();
    } catch (error) {
        res.status(403).json({ message: 'token 无效' });
    }
}

// 根路径路由
app.get('/', (req, res) => {
    console.log('访问根路径 /');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 测试写入路由
app.get('/api/test-write', async (req, res) => {
    try {
        if (!db) {
            throw new Error('数据库未连接');
        }
        const result = await db.collection('test').insertOne({ test: 'Hello from Render', createdAt: new Date() });
        console.log('测试写入成功:', result.insertedId);
        res.json({ message: '写入成功', id: result.insertedId });
    } catch (error) {
        console.error('测试写入失败:', error.message);
        res.status(500).json({ message: '写入失败: ' + error.message });
    }
});

// 注册接口
app.post('/api/register', async (req, res) => {
    try {
        const { username, phone, password } = req.body;
        console.log(`收到注册请求: ${username}`);
        if (!username || !phone || !password) {
            return res.status(400).json({ message: '用户名、手机号和密码不能为空' });
        }

        if (!db) {
            throw new Error('数据库未连接');
        }

        console.log('已连接到数据库:', db.databaseName);
        const existingUser = await db.collection('users').findOne({ username });
        if (existingUser) {
            console.log(`用户已存在: ${username}`);
            return res.status(400).json({ message: '用户名已存在' });
        }

        const hashedPassword = await bcryptjs.hash(password, 10);
        const user = {
            username,
            phone,
            password: hashedPassword,
            wallet: 0,
            isMember: false,
            createdAt: new Date()
        };

        const result = await db.collection('users').insertOne(user);
        if (!result.acknowledged) {
            throw new Error('插入未确认');
        }
        console.log(`用户注册成功: ${username}, 插入ID: ${result.insertedId}`);
        res.json({ message: '注册成功', userId: result.insertedId });
    } catch (error) {
        console.error('注册失败:', error.message);
        res.status(500).json({ message: '注册失败: ' + error.message });
    }
});

// 登录接口
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log(`尝试登录: ${username}`);
        if (!db) {
            throw new Error('数据库未连接');
        }

        const user = await db.collection('users').findOne({ username });
        if (!user) {
            console.log(`用户不存在: ${username}`);
            return res.status(400).json({ message: '用户不存在' });
        }

        const isMatch = await bcryptjs.compare(password, user.password);
        if (!isMatch) {
            console.log(`密码错误: ${username}`);
            return res.status(400).json({ message: '密码错误' });
        }

        const token = jwt.sign({ role: 'user', userId: user._id }, 'your_jwt_secret', { expiresIn: '1h' });
        console.log(`登录成功: ${username}`);
        res.json({ token, user: { username: user.username, wallet: user.wallet, isMember: user.isMember } });
    } catch (error) {
        console.error('登录失败:', error.message);
        res.status(500).json({ message: '登录失败: ' + error.message });
    }
});

// 管理员登录
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('收到管理员登录请求:', { username }); // 添加日志
        if (!username || !password) {
            console.log('用户名或密码为空');
            return res.status(400).json({ message: '用户名和密码不能为空' });
        }

        if (!db) {
            throw new Error('数据库未连接');
        }

        const admin = await db.collection('admins').findOne({ username });
        console.log('查询到的 admin 账户:', admin); // 添加日志
        if (!admin) {
            console.log('用户不存在:', username);
            return res.status(401).json({ message: '用户名或密码错误' });
        }

        const passwordMatch = await bcryptjs.compare(password, admin.password);
        console.log('密码匹配结果:', passwordMatch); // 添加日志
        if (!passwordMatch) {
            console.log('密码错误:', username);
            return res.status(401).json({ message: '用户名或密码错误' });
        }

        const token = jwt.sign({ role: 'admin', userId: admin._id }, 'your_jwt_secret', { expiresIn: '1h' });
        console.log('生成 token 成功:', token); // 添加日志
        res.json({ token });
    } catch (error) {
        console.error('管理员登录失败:', error.message);
        res.status(500).json({ message: '管理员登录失败: ' + error.message });
    }
});

// 获取视频列表（允许未登录用户访问）
app.get('/api/videos', async (req, res) => {
    try {
        if (!db) {
            throw new Error('数据库未连接');
        }
        console.log('当前数据库:', db.databaseName);
        console.log('查询 videos 集合...');
        const videos = await db.collection('videos').find().toArray();
        console.log('查询结果:', videos);
        res.json(videos);
    } catch (error) {
        console.error('获取视频列表失败:', error.message);
        res.status(500).json({ message: '获取视频列表失败: ' + error.message });
    }
});

// 检查视频播放权限
app.post('/api/check-video-access', verifyToken, async (req, res) => {
    try {
        const { videoId } = req.body;
        const userId = req.user.userId;

        if (!db) {
            throw new Error('数据库未连接');
        }

        const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }

        const video = await db.collection('videos').findOne({ _id: new ObjectId(videoId) });
        if (!video) {
            return res.status(404).json({ message: '视频不存在' });
        }

        const purchase = await db.collection('purchases').findOne({
            userId: new ObjectId(userId),
            videoId: new ObjectId(videoId)
        });

        if (video.isPaid && !user.isMember && !purchase) {
            return res.status(403).json({ message: '请购买此视频或成为永久会员以观看' });
        }

        res.json({ canAccess: true, url: video.url });
    } catch (error) {
        console.error('检查视频权限失败:', error.message);
        res.status(500).json({ message: '检查视频权限失败: ' + error.message });
    }
});

// 获取用户信息
app.get('/api/user', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        if (!db) {
            throw new Error('数据库未连接');
        }

        const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }
        res.json({
            username: user.username,
            wallet: user.wallet,
            isMember: user.isMember,
            watchHistory: user.watchHistory || []
        });
    } catch (error) {
        console.error('获取用户信息失败:', error.message);
        res.status(500).json({ message: '获取用户信息失败: ' + error.message });
    }
});

// 充值接口
app.post('/api/recharge', verifyToken, async (req, res) => {
    try {
        const { amount } = req.body;
        const userId = req.user.userId;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: '请输入有效的充值金额' });
        }

        if (!db) {
            throw new Error('数据库未连接');
        }

        const result = await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            { $inc: { wallet: amount } }
        );

        if (result.modifiedCount === 0) {
            return res.status(500).json({ message: '充值失败' });
        }

        res.json({ message: `成功充值 ${amount} 元` });
    } catch (error) {
        console.error('充值失败:', error.message);
        res.status(500).json({ message: '充值失败: ' + error.message });
    }
});

// 管理员修改余额接口
app.post('/api/admin/update-wallet', async (req, res) => {
    try {
        const { username, amount } = req.body;
        console.log('收到修改余额请求:', { username, amount });

        const adminToken = req.headers.authorization?.split(' ')[1];
        if (adminToken !== 'your-admin-token') {
            return res.status(403).json({ message: '无权限，仅限管理员操作' });
        }

        if (!username || amount === undefined) {
            return res.status(400).json({ message: '用户名和金额不能为空' });
        }

        if (!db) {
            throw new Error('数据库未连接');
        }

        const user = await db.collection('users').findOne({ username });
        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }

        await db.collection('users').updateOne(
            { username },
            { $set: { wallet: amount } }
        );

        res.json({ message: `用户 ${username} 的余额已更新为 ${amount} 元` });
    } catch (error) {
        console.error('修改余额失败:', error.message);
        res.status(500).json({ message: '修改余额失败: ' + error.message });
    }
});

// 上传视频接口（建议使用云存储）
app.post('/api/upload-video', upload.single('video'), async (req, res) => {
    try {
        const { title } = req.body;
        const adminToken = req.headers.authorization?.split(' ')[1];
        if (adminToken !== 'your-admin-token') {
            return res.status(403).json({ message: '无权限，仅限管理员操作' });
        }

        if (!title || !req.file) {
            return res.status(400).json({ message: '标题和视频文件不能为空' });
        }

        const videoUrl = `/videos/${req.file.filename}`;
        if (!db) {
            throw new Error('数据库未连接');
        }

        await db.collection('videos').insertOne({
            title,
            url: videoUrl,
            isPaid: true,
            createdAt: new Date()
        });

        res.json({ message: '视频上传成功', url: videoUrl });
    } catch (error) {
        console.error('视频上传失败:', error.message);
        res.status(500).json({ message: '视频上传失败: ' + error.message });
    }
});

// 购买接口（视频或会员）
app.post('/api/purchase', verifyToken, async (req, res) => {
    try {
        const { type, videoId } = req.body;
        const userId = req.user.userId;

        if (!db) {
            throw new Error('数据库未连接');
        }

        const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }

        if (type === 'membership') {
            const price = 200;
            if (user.isMember) {
                return res.status(400).json({ message: '您已经是永久会员' });
            }
            if (user.wallet < price) {
                return res.status(400).json({ message: '余额不足，请充值' });
            }

            await db.collection('users').updateOne(
                { _id: new ObjectId(userId) },
                { $set: { isMember: true, membershipPurchasedAt: new Date() }, $inc: { wallet: -price } }
            );
        } else if (type === 'video' && videoId) {
            const video = await db.collection('videos').findOne({ _id: new ObjectId(videoId) });
            if (!video) {
                return res.status(404).json({ message: '视频不存在' });
            }

            if (user.isMember) {
                return res.json({ message: '您是永久会员，无需购买即可观看', user });
            }

            const price = 3;
            if (user.wallet < price) {
                return res.status(400).json({ message: '余额不足，请充值' });
            }

            await db.collection('users').updateOne(
                { _id: new ObjectId(userId) },
                { $inc: { wallet: -price } }
            );
            await db.collection('purchases').insertOne({
                userId: new ObjectId(userId),
                videoId: new ObjectId(videoId),
                price,
                purchasedAt: new Date()
            });
        } else {
            return res.status(400).json({ message: '无效的购买请求' });
        }

        const updatedUser = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        res.json({
            message: '购买成功',
            user: { username: updatedUser.username, wallet: updatedUser.wallet, isMember: updatedUser.isMember, membershipPurchasedAt: updatedUser.membershipPurchasedAt }
        });
    } catch (error) {
        console.error('购买失败:', error.message);
        res.status(500).json({ message: '购买失败: ' + error.message });
    }
});

// 检查是否已购买视频
app.get('/api/check-purchase/:videoId', verifyToken, async (req, res) => {
    try {
        const { videoId } = req.params;
        const userId = req.user.userId;

        if (!db) {
            throw new Error('数据库未连接');
        }

        const purchase = await db.collection('purchases').findOne({
            userId: new ObjectId(userId),
            videoId: new ObjectId(videoId)
        });

        res.json({ hasPurchased: !!purchase });
    } catch (error) {
        console.error('检查购买状态失败:', error.message);
        res.status(500).json({ message: '检查购买状态失败: ' + error.message });
    }
});

// 获取已购买视频
app.get('/api/my-videos', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        if (!db) {
            throw new Error('数据库未连接');
        }

        const purchases = await db.collection('purchases')
            .aggregate([
                { $match: { userId: new ObjectId(userId) } },
                {
                    $lookup: {
                        from: 'videos',
                        localField: 'videoId',
                        foreignField: '_id',
                        as: 'video'
                    }
                },
                { $unwind: '$video' },
                { $project: { title: '$video.title', url: '$video.url', purchasedAt: 1 } }
            ])
            .toArray();

        res.json(purchases);
    } catch (error) {
        console.error('获取已购买视频失败:', error.message);
        res.status(500).json({ message: '获取已购买视频失败: ' + error.message });
    }
});

// 修改用户名
app.post('/api/update-username', verifyToken, async (req, res) => {
    try {
        const { newUsername } = req.body;
        const userId = req.user.userId;

        if (!newUsername) {
            return res.status(400).json({ message: '新用户名不能为空' });
        }

        if (!db) {
            throw new Error('数据库未连接');
        }

        const existingUser = await db.collection('users').findOne({ username: newUsername });
        if (existingUser) {
            return res.status(400).json({ message: '用户名已存在' });
        }

        const result = await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            { $set: { username: newUsername } }
        );

        if (result.modifiedCount === 0) {
            return res.status(500).json({ message: '修改用户名失败' });
        }

        res.json({ message: '用户名修改成功' });
    } catch (error) {
        console.error('修改用户名失败:', error.message);
        res.status(500).json({ message: '修改用户名失败: ' + error.message });
    }
});

// 记录观看历史
app.post('/api/watch-video', verifyToken, async (req, res) => {
    try {
        const { videoId } = req.body;
        const userId = req.user.userId;

        if (!db) {
            throw new Error('数据库未连接');
        }

        const video = await db.collection('videos').findOne({ _id: new ObjectId(videoId) });
        if (!video) {
            return res.status(404).json({ message: '视频不存在' });
        }

        const purchase = await db.collection('purchases').findOne({
            userId: new ObjectId(userId),
            videoId: new ObjectId(videoId)
        });

        const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        const canWatch = !video.isPaid || purchase || user.isMember;

        await db.collection('users').updateOne(
            { _id: new ObjectId(userId) },
            {
                $push: {
                    watchHistory: {
                        videoId: new ObjectId(videoId),
                        title: video.title,
                        url: video.url,
                        watchedAt: new Date(),
                        canWatch: canWatch
                    }
                }
            },
            { upsert: true }
        );

        if (!canWatch) {
            return res.status(403).json({ message: '您未购买此视频，无法观看' });
        }

        res.json({ message: '观看记录已保存', url: video.url });
    } catch (error) {
        console.error('保存观看记录失败:', error.message);
        res.status(500).json({ message: '保存观看记录失败: ' + error.message });
    }
});

// 获取收藏列表
app.get('/api/favorites', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        if (!db) {
            throw new Error('数据库未连接');
        }

        const favorites = await db.collection('favorites')
            .aggregate([
                { $match: { userId: new ObjectId(userId) } },
                {
                    $lookup: {
                        from: 'videos',
                        localField: 'videoId',
                        foreignField: '_id',
                        as: 'video'
                    }
                },
                { $unwind: '$video' },
                { $project: { title: '$video.title', url: '$video.url', addedAt: 1 } }
            ])
            .toArray();

        res.json(favorites);
    } catch (error) {
        console.error('获取收藏失败:', error.message);
        res.status(500).json({ message: '获取收藏失败: ' + error.message });
    }
});

// 添加收藏
app.post('/api/favorites', verifyToken, async (req, res) => {
    try {
        const { videoId } = req.body;
        const userId = req.user.userId;

        if (!videoId) {
            return res.status(400).json({ message: '视频 ID 不能为空' });
        }

        if (!db) {
            throw new Error('数据库未连接');
        }

        const video = await db.collection('videos').findOne({ _id: new ObjectId(videoId) });
        if (!video) {
            return res.status(404).json({ message: '视频不存在' });
        }

        const existingFavorite = await db.collection('favorites').findOne({
            userId: new ObjectId(userId),
            videoId: new ObjectId(videoId)
        });

        if (existingFavorite) {
            return res.status(400).json({ message: '视频已收藏' });
        }

        await db.collection('favorites').insertOne({
            userId: new ObjectId(userId),
            videoId: new ObjectId(videoId),
            addedAt: new Date()
        });

        res.json({ message: '收藏成功' });
    } catch (error) {
        console.error('添加收藏失败:', error.message);
        res.status(500).json({ message: '添加收藏失败: ' + error.message });
    }
});

// 删除收藏
app.delete('/api/favorites/:videoId', verifyToken, async (req, res) => {
    try {
        const { videoId } = req.params;
        const userId = req.user.userId;

        if (!db) {
            throw new Error('数据库未连接');
        }

        const result = await db.collection('favorites').deleteOne({
            userId: new ObjectId(userId),
            videoId: new ObjectId(videoId)
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: '收藏记录不存在' });
        }

        res.json({ message: '取消收藏成功' });
    } catch (error) {
        console.error('删除收藏失败:', error.message);
        res.status(500).json({ message: '删除收藏失败: ' + error.message });
    }
});

// 获取用户消息
app.get('/api/user-messages', async (req, res) => {
    try {
        const username = req.query.username;
        console.log('收到获取消息请求:', { username }); // 添加日志
        if (!username) {
            console.log('用户名未提供');
            return res.status(400).json({ message: '用户名未提供' });
        }
        if (!db) {
            throw new Error('数据库未连接');
        }

        const messages = await db.collection('messages').find({ username }).toArray();
        console.log('返回的消息:', messages); // 添加日志
        res.json({ data: messages });
    } catch (error) {
        console.error('获取消息失败:', error.message);
        res.status(500).json({ message: '获取消息失败: ' + error.message });
    }
});

// 发送消息
app.post('/api/send-message', async (req, res) => {
    try {
        const { username, content } = req.body;
        console.log('收到发送消息请求:', { username, content }); // 添加日志
        if (!username || !content) {
            console.log('用户名或消息内容为空');
            return res.status(400).json({ message: '用户名和消息内容不能为空' });
        }
        if (!db) {
            throw new Error('数据库未连接');
        }

        const result = await db.collection('messages').insertOne({
            username,
            content,
            type: 'user',
            timestamp: new Date(),
            status: 'pending'
        });
        console.log('消息插入结果:', result); // 添加日志

        res.json({ message: '消息发送成功', messageId: result.insertedId });
    } catch (error) {
        console.error('发送消息失败:', error.message);
        res.status(500).json({ message: '发送消息失败: ' + error.message });
    }
});

// 获取管理员消息列表
app.get('/api/messages/admin', verifyToken, async (req, res) => {
    try {
        const decoded = req.user;
        console.log('收到管理员获取消息列表请求:', { user: decoded }); // 添加日志
        if (decoded.role !== 'admin') {
            console.log('无权限访问');
            return res.status(403).json({ message: '无权限，仅限管理员操作' });
        }

        if (!db) {
            throw new Error('数据库未连接');
        }

        const messages = await db.collection('messages').find().toArray();
        console.log('管理员消息列表:', messages); // 添加日志
        res.json(messages);
    } catch (error) {
        console.error('获取管理员消息列表失败:', error.message);
        res.status(500).json({ message: '获取管理员消息列表失败: ' + error.message });
    }
});

// 回复消息
app.post('/api/messages/:messageId/reply', verifyToken, async (req, res) => {
    try {
        const { messageId } = req.params;
        const { content } = req.body;
        console.log('收到回复请求:', { messageId, content }); // 添加日志

        const decoded = req.user;
        if (decoded.role !== 'admin') {
            console.log('无权限，仅限管理员操作');
            return res.status(403).json({ message: '无权限，仅限管理员操作' });
        }

        if (!content) {
            console.log('回复内容为空');
            return res.status(400).json({ message: '回复内容不能为空' });
        }

        if (!db) {
            throw new Error('数据库未连接');
        }

        const message = await db.collection('messages').findOne({ _id: new ObjectId(messageId) });
        console.log('查询到的消息:', message); // 添加日志
        if (!message) {
            console.log('消息不存在:', messageId);
            return res.status(404).json({ message: '消息不存在' });
        }

        if (message.status === 'replied') {
            console.log('消息已回复:', messageId);
            return res.status(400).json({ message: '消息已回复' });
        }

        const result = await db.collection('messages').updateOne(
            { _id: new ObjectId(messageId) },
            {
                $set: {
                    reply: content,
                    status: 'replied',
                    repliedAt: new Date()
                }
            }
        );
        console.log('回复保存结果:', result); // 添加日志

        if (result.modifiedCount === 0) {
            console.log('消息未更新:', messageId);
            return res.status(500).json({ message: '消息未更新' });
        }

        res.json({ message: '回复成功' });
    } catch (error) {
        console.error('回复消息失败:', error.message);
        res.status(500).json({ message: '回复消息失败: ' + error.message });
    }
});

// 自定义 404 响应
app.use((req, res, next) => {
    console.log(`未找到路径: ${req.path}`);
    res.status(404).json({ message: '接口不存在' });
});

// 启动服务器
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 服务已启动: http://0.0.0.0:${port}`);
});