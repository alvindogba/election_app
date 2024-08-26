const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./election.db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const dotenv = require('dotenv');
dotenv.config();

const saltRounds = 10;

// Initialize database schema
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS auth (id INTEGER PRIMARY KEY AUTOINCREMENT, user_name TEXT UNIQUE, password TEXT, user_id INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, middle_name TEXT, last_name TEXT, role_id INTEGER, date_of_birth DATE, phone INTEGER, image TEXT, user_name TEXT UNIQUE, password TEXT, voted TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS party (id INTEGER PRIMARY KEY AUTOINCREMENT, party_name TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS candidate (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, middle_name TEXT, last_name TEXT, position_id INTEGER, photo BLOB, party_id INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS votes (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER NOT NULL, votes INTEGER, user_id INTEGER UNIQUE)");
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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

// Routes
app.get('/', (req, res) => {
    res.render('login');
});

app.get('/complete_registration', async (req, res) => {
    try {
        const [roles, parties, positions] = await Promise.all([
            allAsync("SELECT * FROM roles"),
            allAsync("SELECT * FROM party"),
            allAsync("SELECT * FROM position")
        ]);
        res.render("voters_registration", { roledata: roles, partyData: parties, positionData: positions });
    } catch (err) {
        console.error("Error fetching data:", err.message);
        res.status(500).send('Server error.');
    }
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
            const hashedPassword = await bcrypt.hash(req.body.password, saltRounds);
            if (req.body.role === "3") {
                await runAsync("INSERT INTO candidate (first_name, middle_name, last_name, position_id, photo, party_id) VALUES (?, ?, ?, ?, ?, ?)", [
                    req.body.first_name, req.body.middle_name, req.body.last_name, req.body.position, photoPath, req.body.party
                ]);
            } else {
                await runAsync("INSERT INTO users (first_name, middle_name, last_name, role_id, date_of_birth, phone, image, user_name, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                    req.body.first_name, req.body.middle_name, req.body.last_name, req.body.role,
                    req.body.date_of_birth, req.body.phone, photoPath,
                    req.body.user_name, hashedPassword
                ]);
            }
            await runAsync("INSERT INTO auth (user_name, password) VALUES (?, ?)", [
                req.body.user_name, hashedPassword
            ]);
            res.render("login");
        } catch (error) {
            console.error("Registration error:", error.message);
            res.status(500).send('User name is already taken');
        }
    }
);

app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        // Fetch user data for authentication
        const row = await getAsync("SELECT * FROM auth WHERE user_name = ?", [username]);
        
        if (!row || !(await bcrypt.compare(password, row.password))) {
            return res.status(401).send('Invalid credentials.');
        }

        // Fetch total registered voters and total votes
        const [totalRegVoters, totalVotes] = await Promise.all([
            getAsync('SELECT COUNT(*) AS total FROM users'),
            getAsync('SELECT COUNT(*) AS total FROM votes')
        ]);

        // Fetch candidate information
        const candidate_info = await allAsync(`
                    SELECT 
    candidate.first_name, 
    candidate.middle_name, 
    candidate.last_name, 
    candidate.photo,
    position.position,
    party.party_name,
    COALESCE(SUM(votes.votes), 0) AS votes
FROM 
    candidate
INNER JOIN 
    position ON candidate.position_id = position.id
INNER JOIN 
    party ON candidate.party_id = party.id
LEFT JOIN 
    votes ON candidate.id = votes.candidate_id
WHERE 
    candidate.position_id = 1
GROUP BY 
    candidate.id, candidate.first_name, candidate.middle_name, candidate.last_name, 
    candidate.photo, position.position, party.party_name;
        `);

      
        const cand_votes = await allAsync('SELECT * FROM votes');
        console.log(cand_votes);

        // Render the dashboard with the fetched data
        res.render("dashboard", {
            total_reg_voters: totalRegVoters.total,
            total_vote: totalVotes.total,
            candidate_info
        });
    } catch (err) {
        console.error("Login error:", err.message);
        res.status(500).send('Error fetching user data.');
    }
});

app.get("/dashboard", async (req, res)=>{
    try {

        // Fetch total registered voters and total votes
        const [totalRegVoters, totalVotes] = await Promise.all([
            getAsync('SELECT COUNT(*) AS total FROM users'),
            getAsync('SELECT COUNT(*) AS total FROM votes')
        ]);

        // Fetch candidate information
        const candidate_info = await allAsync(`
                   SELECT 
    candidate.first_name, 
    candidate.middle_name, 
    candidate.last_name, 
    candidate.photo,
    position.position,
    party.party_name,
    COALESCE(SUM(votes.votes), 0) AS votes
FROM 
    candidate
INNER JOIN 
    position ON candidate.position_id = position.id
INNER JOIN 
    party ON candidate.party_id = party.id
LEFT JOIN 
    votes ON candidate.id = votes.candidate_id
WHERE 
    candidate.position_id = 1
GROUP BY 
    candidate.id, candidate.first_name, candidate.middle_name, candidate.last_name, 
    candidate.photo, position.position, party.party_name;


        `);

      
        const cand_votes = await allAsync('SELECT * FROM votes');
        console.log(candidate_info);

        // Render the dashboard with the fetched data
        res.render("dashboard", {
            total_reg_voters: totalRegVoters.total,
            total_vote: totalVotes.total,
            candidate_info
        });
    } catch (err) {
        console.error("Login error:", err.message);
        res.status(500).send('Error fetching user data.');
    }
})

app.get("/candidates", async (req, res) => {
    try {
        const candidates = await allAsync("SELECT * FROM candidate WHERE candidate.position_id = 1");
      
        res.render("candidates", { candidates });
    } catch (err) {
        console.error("Error fetching candidates:", err.message);
        res.status(500).send('Server error.');
    }
});

app.get("/cast_vote", async (req, res) => {
    const userId = req.query.user_id;
    try {
        const candidates = await allAsync("SELECT * FROM candidate WHERE candidate.position_id = 1");
        res.render("vote", { candidates, userId });
    } catch (err) {
        console.error("Error fetching candidates:", err.message);
        res.status(500).send('Server error.');
    }
});

app.post("/cast_vote_complete", async (req, res) => {
    const { userId, candidate_id } = req.body;
    console.log(userId, candidate_id)
    if (!userId || !candidate_id) {
        return res.status(400).send("User ID and candidate ID are required");
    }


    const voteStatus = true;
    try {
        await runAsync("UPDATE users SET voted =? WHERE id = ?", ["true", userId]);
        await runAsync("INSERT INTO votes (candidate_id, votes, user_id) VALUES (?, ?, ?)", [candidate_id, voteStatus, userId]);
        res.redirect("/voters");
    } catch (err) {
        console.error("Vote casting error:", err.message);
        res.status(500).send('Database error.');
    }
});

app.get("/voters", async (req, res) => {
    try {
        const votersData = await allAsync("SELECT * FROM users");
        res.render('voters', { voters_data: votersData });
    } catch (err) {
        console.error("Error fetching voters:", err.message);
        res.status(500).send('Server error.');
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error("Server error:", err.stack);
    res.status(500).send('Something broke!');
});

// Start server
app.listen(port, () => {
    console.log(`App is running on port ${port}`);
});

// Close database connection on termination
process.on('SIGINT', () => {
    db.close(err => {
        if (err) {
            console.error("Error closing database:", err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});

// Helper functions for async database operations
const runAsync = (stmt, params) => {
    return new Promise((resolve, reject) => {
        db.run(stmt, params, function (err) {
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
