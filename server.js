const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./election.db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator'); //Middleware to validate input 
const dotenv = require('dotenv'); 
dotenv.config(); //exstablishing dontenv to manage port and other setting

const saltRounds = 10; //Amount of rounds password should be bcrypt

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS auth (id INTEGER PRIMARY KEY AUTOINCREMENT, user_name TEXT UNIQUE, password TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, middle_name TEXT, last_name TEXT, row TEXT, date_of_birth DATE, phone INTEGER, image TEXT, user_name TEXT UNIQUE, password TEXT)");
   db.run("CREATE TABLE IF NOT EXISTS party (id INTEGER PRIMARY KEY AUTOINCREMENT, party_name TEXT)")
    db.run("CREATE TABLE IF NOT EXISTS rows (id INTEGER PRIMARY KEY AUTOINCREMENT, row TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS candidate (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, middle_name TEXT, last_name TEXT, position	TEXT, photo	BLOB, party_id	INTEGER)")
});



// Middleware to parse URL-encoded bodies (as sent by HTML forms)
app.use(express.urlencoded({ extended: true }));
// Setting up static directory
app.use(express.static("public"));
// Setting up views engine
app.set('view engine', 'ejs');

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'public/uploads');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only images are allowed!'));
    }
});

// Define a route for the homepage
app.get('/', (req, res) => {
    res.render('login');
});

// Registration
app.get('/complete_registration', async (req, res) => {
    db.all("SELECT * FROM rows", (err, rows) => {
        if (err) {
            console.error("Error fetching rows:", err.message);
            return res.status(500).send('Server error.');
        }
        db.all("SELECT * FROM party", (err, parties) => {
            if (err) {
                console.error("Error fetching parties:", err.message);
                return res.status(500).send('Server error.');
            }
            db.all("SELECT * FROM position", (err, positions) => {
                if (err) {
                    console.error("Error fetching positions:", err.message);
                    return res.status(500).send('Server error.');
                }
                res.render("voters_registration.ejs", { rowdata: rows, partyData: parties, positionData: positions });
            });
        });
    });
});


app.post('/complete_registration', 
    upload.single('user_image'),
    [
        body('first_name').notEmpty().withMessage('First name is required'),
        body('password').isLength({ min: 5 }).withMessage('Password must be at least 5 characters long'),
        // Add more validations as needed
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const photoPath = req.file ? path.join('uploads', req.file.filename) : null;
        try {
            // Hash the password
            const hashedPassword = await bcrypt.hash(req.body.password, saltRounds);
            
            // Insert the registration data into the tables base on user role
            if(req.body.row === "3"){
                const candidate = "INSERT INTO candidate (first_name, middle_name, last_name, position, photo, party_id) VALUES (?, ?, ?, ?, ?, ?)";
                await runAsync(candidate, [
                    req.body.first_name, req.body.middle_name, req.body.last_name, req.body.position, photoPath, req.body.party
                ]);
            }else{
                const stmt = "INSERT INTO users (first_name, middle_name, last_name, row, date_of_birth, phone, image, user_name, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
            await runAsync(stmt, [
                req.body.first_name, req.body.middle_name, req.body.last_name, req.body.row,
                req.body.date_of_birth, req.body.phone, photoPath,
                req.body.user_name, hashedPassword
            ]);

            }
            
            // Insert into 'auth' table
            await runAsync("INSERT INTO auth (user_name, password) VALUES (?, ?)", [
                req.body.user_name, hashedPassword
            ]);

            res.render("login");
        } catch (error) {
            console.error(error.message);
            res.status(500).send('Server error.');
        }
    }
);

// Route for user login
app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        const row = await getAsync("SELECT * FROM auth WHERE user_name = ?", [username]);

        if (!row || !(await bcrypt.compare(password, row.password))) {
            return res.status(401).send('Invalid credentials.');
        }

        // Fetch user details and party data
        const users = await allAsync('SELECT * FROM users WHERE user_name = ?', [username]);
        const parties = await allAsync("SELECT * FROM party");

        
        db.all("SELECT * FROM users", (err, voters) => {
            if (err) {
                console.error("Error fetching rows:", err.message);
                return res.status(500).send('Server error.');
            }
            res.render('dashboard', { data: parties, voters: voters });
        });
        

        
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error fetching user data.');
    }
});

// The voting route
app.get("/vote", (req, res) => {
    res.render("vote");
});

// Route to handle completed vote
app.post("/vote_complete", (req, res) => {
    //Selecting All Voter from user Table
    
    res.render("dashboard");
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start the Express server
app.listen(port, () => {
    console.log(`App is running on port ${port}`);
});

// Close the database connection when the Node.js process is terminated
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});

// Helper functions for async database operations
const runAsync = (stmt, params) => {
    return new Promise((resolve, reject) => {
        db.run(stmt, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
};

const getAsync = (stmt, params) => {
    return new Promise((resolve, reject) => {
        db.get(stmt, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
};

const allAsync = (stmt, params) => {
    return new Promise((resolve, reject) => {
        db.all(stmt, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
          }
        });
    });
};
