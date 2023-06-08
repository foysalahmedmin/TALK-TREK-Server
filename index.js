const express = require('express')
const app = express()
const cors = require('cors');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' })
    }

    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}

const uri = `mongodb+srv://${process.env.DB_USER_NAME}:${process.env.DB_PASSWORD}@cluster0.7y3daag.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // await client.connect();
        const database = client.db("TalkTrekDB");
        const UserCollection = database.collection("UserCollection");
        const ClassCollection = database.collection("ClassCollection");

        //JWT
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ token })
        })

        //User
        app.post('/user', async (req, res) => {
            const user = req.body
            const query = {
                email: user.email
            }
            const userExist = await UserCollection.findOne(query);
            if (userExist) {
                return
            } else {
                const result = await UserCollection.insertOne(user);
                res.send(result);
            }
        })

        //Classes
        app.get('/classes', async (req, res) => {
            const sortPopular = req.query?.sort
            if (sortPopular === 'popularClasses') {
                const result = await ClassCollection.find().sort({ bookedSeats: -1 }).toArray()
                res.send(result);
            } else {
                const result = await ClassCollection.find().toArray()
                res.send(result);
            }

        })

        //Instructor
        app.get('/instructor', async (req, res) => {
            const sortPopular = req.query?.sort
            if (sortPopular === 'popularInstructor') {
                const pipeline = [
                    {
                        $match: {Role : 'instructor'}
                    },
                    {
                        $lookup : {
                            from: 'ClassCollection',
                            localField: '_id',
                            foreignField: 'instructorId',
                            as: 'classes'
                        }
                    },
                    {
                        $addFields:{
                            totalBookedSeats: {
                                $sum: '$classes.bookedSeats'
                            }
                        }
                    },
                    {
                        $sort: {
                            totalBookedSeats: -1
                        }
                    }
                ]
                
                const result = await UserCollection.aggregate(pipeline).toArray()
                res.send(result);
            } else {
                const result = await UserCollection.find({Role: 'instructor'}).toArray()
                res.send(result);
            }

        })



        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Welcome to TalkTrek!');
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
})