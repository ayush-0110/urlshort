const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();
const { createClient } = require('redis');

const path = require('path');
app.use(express.static(path.join(__dirname)));

const SECRET_KEY = 'mysecretkey'; 


let urlCollection, usersCollection;

const client = createClient({
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
});

client.on('connect', () => {
    console.log('Connected to Redis');
  console.log(client); 
});

client.on('error', (error) => {
    console.error('Error connecting to Redis:', error);
});


async function main() {
  const mongoClient = new MongoClient(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  
  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB');

    const db = mongoClient.db();
    // Assign the 'urls' collection to the urlCollection variable
    urlCollection = db.collection('urls');
    usersCollection = db.collection('users');

  } catch (error) {
    console.error('Error connecting to MongoDB', error);
  }finally {
    // await mongoClient.close();
  }
}



main().catch(console.error);


app.use(express.json());

const urlDatabase = {};

  
function generateShortCode() {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const shortCodeLength = 6;
  let shortCode = '';

  for (let i = 0; i < shortCodeLength; i++) {
    shortCode += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return shortCode;
}

function authenticate(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
  
    if (!token) {
      return res.status(401).json({ error: 'Missing or invalid token' });
    }
  
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      req.userId = decoded.userId;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Invalid token' });
    }
  }

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
  
    const hashedPassword = await bcrypt.hash(password, 10);
  
    try {
      const result = await usersCollection.insertOne({ username, password: hashedPassword });
      res.status(201).json({ message: 'User registered successfully', userId: result.insertedId });
    } catch (error) {
      res.status(500).json({ error: 'Error registering user' });
    }
  });

  app.post('/login', async (req, res) => {
    const { username, password } = req.body;
  
    try {
      const user = await usersCollection.findOne({ username });
  
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
  

      const token = jwt.sign({ userId: user._id }, SECRET_KEY, { expiresIn: '1h' });
      res.json({ message: 'Logged in successfully', token });
    } catch (error) {
      res.status(500).json({ error: 'Error logging in' });
    }
  });

  app.get('/protected', authenticate, (req, res) => {
    res.json({ message: 'This is a protected route', userId: req.userId });
  });

  const rateLimit = require('express-rate-limit');

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limiting each IP to 100 requests per windowMs
    message: 'Too many requests , please try again after 15 minutes',
  });
  
  app.use(apiLimiter);

app.post('/shorten', async (req, res) => {
    const { url } = req.body;
  
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
  
    const shortCode = generateShortCode();
  
    try {
        await urlCollection.insertOne({ shortCode, originalUrl: url });
      } catch (error) {
        console.error('Error saving URL to database:', error);
        return res.status(500).json({ error: 'Error saving URL to database' });
      }
    const shortUrl = `${req.protocol}://${req.get('host')}/${shortCode}`;
  
    res.json({ shortUrl });
  });
  

  app.get('/:shortCode', async (req, res) => {
    const { shortCode } = req.params;
  
   
    client.get(shortCode, async (error, cachedUrl) => {
      if (error) {
        return res.status(500).json({ error: 'Error fetching URL from cache' });
      }
  
      if (cachedUrl) {
        res.redirect(cachedUrl);
      } else {
        let urlDocument;
        try {
          urlDocument = await urlCollection.findOne({ shortCode });
        } catch (error) {
          return res.status(500).json({ error: 'Error fetching URL from database' });
        }
  
        if (!urlDocument) {
          return res.status(404).json({ error: 'Short URL not found' });
        }
  
        await client.setexAsync(shortCode, 3600, urlDocument.originalUrl);
  
        res.redirect(urlDocument.originalUrl);
      }
    });
  });
  

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
