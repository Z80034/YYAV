const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'yyav';
const videosDir = path.join(__dirname, 'videos');
const baseUrl = 'http://localhost:8080/videos/';

async function insertRealVideos() {
  const client = new MongoClient(mongoUrl, { connectTimeoutMS: 5000 });
  try {
    await client.connect();
    console.log('✅ MongoDB 连接成功');
    const db = client.db(dbName);

    await db.collection('videos').deleteMany({});
    console.log('已清空 videos 集合');

    const files = fs.readdirSync(videosDir);
    const videoFiles = files.filter(file => /\.(mp4|avi|mov|wmv)$/i.test(file));

    if (videoFiles.length === 0) {
      console.log('videos 目录中没有视频文件');
      return;
    }

    const videos = videoFiles.map((file, index) => ({
      title: `我的视频 ${index + 1}`,
      url: `${baseUrl}${file}`,
      isPaid: index >= 5, // 前 5 个视频免费，其余付费
      createdAt: new Date()
    }));

    const result = await db.collection('videos').insertMany(videos);
    console.log(`成功插入 ${result.insertedCount} 个视频`);
  } catch (error) {
    console.error('插入视频失败:', error);
  } finally {
    await client.close();
    console.log('MongoDB 连接已关闭');
  }
}

insertRealVideos();