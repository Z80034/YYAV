const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'yyav';
const port = 3000;

app.use(express.json());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 配置 multer 用于文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'videos/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// 提供静态文件访问（视频文件和图片）
app.use('/videos', express.static(path.join(__dirname, 'videos')), (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:8080');
  res.header('Access-Control-Allow-Methods', 'GET');
  next();
});
app.use('/images', express.static(path.join(__dirname, 'images')));

let db;
(async () => {
  const client = new MongoClient(mongoUrl, { connectTimeoutMS: 5000 });
  try {
    await client.connect();
    console.log('✅ MongoDB 连接成功');
    db = client.db(dbName);
  } catch (error) {
    console.error('❌ MongoDB 连接失败:', error);
  }
})();

// 验证 token 的中间件
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: '未提供 token' });
  }
  try {
    const decoded = jwt.verify(token, 'your_jwt_secret');
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ message: 'token 无效' });
  }
}

// 注册接口
app.post('/api/register', async (req, res) => {
  try {
    const { username, phone, password } = req.body;
    if (!username || !phone || !password) {
      return res.status(400).json({ message: '用户名、手机号和密码不能为空' });
    }

    const existingUser = await db.collection('users').findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
      username,
      phone,
      password: hashedPassword,
      wallet: 0,
      isMember: false,
      createdAt: new Date()
    };

    const result = await db.collection('users').insertOne(user);
    res.json({ message: '注册成功', userId: result.insertedId });
  } catch (error) {
    console.error('注册失败:', error);
    res.status(500).json({ message: '注册失败' });
  }
});

// 登录接口
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.collection('users').findOne({ username });
    if (!user) {
      return res.status(400).json({ message: '用户不存在' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: '密码错误' });
    }

    const token = jwt.sign({ userId: user._id }, 'your_jwt_secret', { expiresIn: '1h' });
    res.json({ token, user: { username: user.username, wallet: user.wallet, isMember: user.isMember } });
  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({ message: '登录失败' });
  }
});

// 获取视频列表（允许未登录用户访问）
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await db.collection('videos').find().toArray();
    res.json(videos);
  } catch (error) {
    console.error('获取视频列表失败:', error);
    res.status(500).json({ message: '获取视频列表失败' });
  }
});

// 检查视频播放权限
app.post('/api/check-video-access', verifyToken, async (req, res) => {
  try {
    const { videoId } = req.body;
    const userId = req.user.userId;

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
    console.error('检查视频权限失败:', error);
    res.status(500).json({ message: '检查视频权限失败' });
  }
});

// 获取用户信息
app.get('/api/user', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
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
    console.error('获取用户信息失败:', error);
    res.status(500).json({ message: '获取用户信息失败' });
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

    const result = await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $inc: { wallet: amount } }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ message: '充值失败' });
    }

    res.json({ message: `成功充值 ${amount} 元` });
  } catch (error) {
    console.error('充值失败:', error);
    res.status(500).json({ message: '充值失败' });
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
    console.error('修改余额失败:', error);
    res.status(500).json({ message: '修改余额失败' });
  }
});

// 上传视频接口
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

    const videoUrl = `http://localhost:3000/videos/${req.file.filename}`;
    await db.collection('videos').insertOne({
      title,
      url: videoUrl,
      isPaid: true,
      createdAt: new Date()
    });

    res.json({ message: '视频上传成功' });
  } catch (error) {
    console.error('视频上传失败:', error);
    res.status(500).json({ message: '视频上传失败' });
  }
});

// 购买接口（视频或会员）
app.post('/api/purchase', verifyToken, async (req, res) => {
  try {
    const { type, videoId } = req.body;
    const userId = req.user.userId;

    const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    if (type === 'membership') {
      const price = 200; // 永久会员价格 200 元
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

      const price = 3; // 非会员固定价格 3 元
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
    console.error('购买失败:', error);
    res.status(500).json({ message: '购买失败' });
  }
});

// 检查是否已购买视频
app.get('/api/check-purchase/:videoId', verifyToken, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user.userId;

    const purchase = await db.collection('purchases').findOne({
      userId: new ObjectId(userId),
      videoId: new ObjectId(videoId)
    });

    res.json({ hasPurchased: !!purchase });
  } catch (error) {
    console.error('检查购买状态失败:', error);
    res.status(500).json({ message: '检查购买状态失败' });
  }
});

// 获取已购买视频
app.get('/api/my-videos', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
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
    console.error('获取已购买视频失败:', error);
    res.status(500).json({ message: '获取已购买视频失败' });
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
    console.error('修改用户名失败:', error);
    res.status(500).json({ message: '修改用户名失败' });
  }
});

// 记录观看历史
app.post('/api/watch-video', verifyToken, async (req, res) => {
  try {
    const { videoId } = req.body;
    const userId = req.user.userId;

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
    console.error('保存观看记录失败:', error);
    res.status(500).json({ message: '保存观看记录失败' });
  }
});

// 自定义 404 响应
app.use((req, res, next) => {
  res.status(404).json({ message: '接口不存在' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 服务已启动: http://0.0.0.0:${port}`);
});