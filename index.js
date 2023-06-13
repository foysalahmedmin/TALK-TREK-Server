const express = require('express')
const app = express()
const cors = require('cors');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000
const stripe = require("stripe")(process.env.STRIPE_SK);

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
        const SelectedClassCollection = database.collection("SelectedClassCollection");
        const EnrolledClassCollection = database.collection("EnrolledClassCollection");
        const PaymentHistory = database.collection("PaymentHistory");

        //JWT
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ token })
        })
        //Verifications
        const verifyStudent = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { Email: email }
            const user = await UserCollection.findOne(query);
            if (user?.Role !== 'student') {
                return res.status(403).send({ error: true, message: 'Forbidden User' });
            }
            next()
        }
        const verifyInstructor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { Email: email }
            const user = await UserCollection.findOne(query);
            if (user?.Role !== 'instructor') {
                return res.status(403).send({ error: true, message: 'Forbidden User' });
            }
            next()
        }
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { Email: email }
            const user = await UserCollection.findOne(query);
            if (user?.Role !== 'admin') {
                return res.status(403).send({ error: true, message: 'Forbidden User' });
            }
            next()
        }

        //User
        app.post('/user/:email', async (req, res) => {
            const user = req.body
            const email = req.params.email
            const query = {
                Email : email
            }
            const userExist = await UserCollection.findOne(query);
            if (!userExist) {
                const result = await UserCollection.insertOne(user);
                res.send(result);
            }
        })
        //Student Verify
        app.get('/user/isStudent/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                res.send({ student: false })
            }
            const query = { Email: email }
            const findUser = await UserCollection.findOne(query);
            if (findUser) {
                const result = { student: findUser.Role === 'student' };
                res.send(result)
            }
        })

        //Instructor Verify
        app.get('/user/isInstructor/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                res.send({ instructor: false })
            }
            const query = { Email: email }
            const findUser = await UserCollection.findOne(query);
            if (findUser) {
                const result = { instructor: findUser.Role === 'instructor' };
                res.send(result)
            }
        })

        //Admin Verify
        app.get('/user/isAdmin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                res.send({ admin: false })
            }
            const query = { Email: email }
            const findUser = await UserCollection.findOne(query);
            if (findUser) {
                const result = { admin: findUser.Role === 'admin' };
                res.send(result)
            }
        })

        //Classes Page
        app.get('/classes', async (req, res) => {
            const sortPopular = req.query?.sort
            if (sortPopular === 'popularClasses') {
                const result = await ClassCollection.find({status: 'approved'}).sort({ bookedSeats: -1 }).toArray()
                res.send(result);
            } else {
                const result = await ClassCollection.find({status: 'approved'}).toArray()
                res.send(result);
            }

        })

        //Instructor Page
        app.get('/instructors', async (req, res) => {
            const sortPopular = req.query?.sort
            const instructors = await UserCollection.find({ Role: 'instructor' }).toArray()
            if (sortPopular === 'popularInstructor') {
                instructorsWithClasses = await Promise.all(
                    instructors.map(async (instructor) => {
                        const classes = await ClassCollection
                            .find({ _id: { $in: instructor.ApprovedClassesId.map((id) => new ObjectId(id)) } })
                            .toArray()
                        const TotalBookedSeats = classes.reduce((total, singleClass) => {
                            return total + singleClass.bookedSeats
                        }, 0);
                        return { ...instructor, TotalBookedSeats }
                    })
                )
                const result = instructorsWithClasses.sort((a, b) => {
                    return b.TotalBookedSeats - a.TotalBookedSeats
                })
                res.send(result);
            } else {
                res.send(instructors);
            }

        })

        //Student
        app.post('/student/selectClass/:email', verifyJWT, verifyStudent, async (req, res) => {
            const selectedClass = req.body
            const email = req.params.email;
            const findSelectedClass = await SelectedClassCollection.findOne({ studentEmail: email, classId: selectedClass.classId });
            const findEnrolledClass = await EnrolledClassCollection.findOne({ studentEmail: email, classId: selectedClass.classId });
            if (findSelectedClass) {
                return res.send({ message: 'This Class Already Selected' })
            } else if (findEnrolledClass) {
                return res.send({ message: 'This Class Already Enrolled' })
            } else {
                const result = await SelectedClassCollection.insertOne(selectedClass)
                res.send(result)
            }
        })

        app.post("/create-payment-intent", async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                automatic_payment_methods: {
                    enabled: true,
                },
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        app.delete('/student/deleteClass/:id', verifyJWT, verifyStudent, async (req, res) => {
            const email = req.query?.email
            const id = req.params.id;
            const result = await SelectedClassCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        })

        app.get('/student/selectedClasses/:email', verifyJWT, verifyStudent, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                return res.status(401).send({ error: true, message: 'Unauthorized access' });
            }
            const query = { studentEmail: email }
            const result = await SelectedClassCollection.find(query).toArray();
            res.send(result)
        })

        app.get('/student/selectedSingleClasses/:id', verifyJWT, verifyStudent, async (req, res) => {
            const email = req.query?.email
            const id = req.params.id;
            const result = await SelectedClassCollection.findOne({ _id: new ObjectId(id) })
            res.send(result)
        })

        app.post('/student/enrolledClass/:email', verifyJWT, verifyStudent, async (req, res) => {
            const {enrolledClass, paymentInfo} = req.body
            const email = req.params.email;
            const findEnrolledClassClassInSelectedClass = await SelectedClassCollection.findOne({ studentEmail: email, classId: enrolledClass.classId });
            if(findEnrolledClassClassInSelectedClass){
                const result = await SelectedClassCollection.deleteOne({ studentEmail: email, classId: enrolledClass.classId });
            }
            const classUpdate = await ClassCollection.updateOne({_id: new ObjectId(enrolledClass.classId)}, {$inc:{bookedSeats: 1, availableSeats: -1}})
            const paymentHistoryInsert = PaymentHistory.insertOne(paymentInfo)
            const result = await EnrolledClassCollection.insertOne(enrolledClass)
            res.send(result)
        })

        app.get('/student/enrolledClasses/:email', verifyJWT, verifyStudent, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                return res.status(401).send({ error: true, message: 'Unauthorized access' });
            }
            const query = { studentEmail: email }
            const result = await EnrolledClassCollection.find(query).toArray();
            res.send(result)
        })
        app.get('/student/paymentHistory/:email', verifyJWT, verifyStudent, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) {
                return res.status(401).send({ error: true, message: 'Unauthorized access' });
            }
            const query = { studentEmail: email }
            const result = await PaymentHistory.find(query).sort({date : -1}).toArray();
            res.send(result)
        })


        //Instructor
        app.get('/instructor/instructorClasses/:email',verifyJWT, verifyAdmin, async (req, res) =>{
            const email = req.params.email
            const result = await ClassCollection.find({instructorEmail: email}).toArray();
            res.send(result)
        })
        

        //Admin
        app.get('/admin/allClasses/:email',verifyJWT, verifyAdmin, async (req, res) =>{
            const result = await ClassCollection.find().toArray();
            res.send(result)
        })
        app.put('/admin/feedback/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id ;
            const feedbackMessage = req.body.feedback
            const feedbackUpdate = {
                $set : {
                    feedback : feedbackMessage
                }
            }
            const result = await ClassCollection.updateOne({_id: new ObjectId(id)}, feedbackUpdate, { upsert: true })
            res.send(result);
        })
        
        app.put('/admin/updateStatus/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id ;
            const status = req.body.status
            const instructorEmail = req.body.instructorEmail ;
            console.log(instructorEmail, status)
            const instructor = await UserCollection.updateOne({Email : instructorEmail}, {$addToSet: {ApprovedClassesId : id}})
            const feedbackUpdate = {
                $set : {
                    status : status
                }
            }
            const result = await ClassCollection.updateOne({_id: new ObjectId(id)}, feedbackUpdate, { upsert: true })
            res.send(result);
        })
        
        app.get('/admin/allUsers/:email',verifyJWT, verifyAdmin, async (req, res) =>{
            const result = await UserCollection.find().toArray();
            res.send(result)
        })

        app.put('/admin/updateUserRole/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id ;
            const role = req.body.role
            const feedbackUpdate = {
                $set : {
                    Role : role
                }
            }
            const result = await UserCollection.updateOne({_id: new ObjectId(id)}, feedbackUpdate, { upsert: true })
            res.send(result);
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











/*
const pipeline = [
    {
        $match: {Role: 'instructor'}
    },
    {
        $lookup: {
            from: 'ClassCollection',
            localField: 'ApprovedClassesId',
            foreignField: '_id',
            as: 'classes'
        }
    },
    {
        $addFields: {
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
*/