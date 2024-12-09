const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET;

//Midleware to verify if user is leader of game session or not
const verifyLeaderSession = (req, res, next) => {

    //Grab the token from cookies - NEW: adding leaderSession as param in body
    const token = req.cookies.leaderSession || req.body.leaderSession ;

    //No token?
    console.log(token);

    if (!token) {
        return res.status(401).json({ error: "Unauthorized: No token provided" });
    }

    try {
        const decoded = jwt.verify(token, secret);
        //Check if they have the role leader in the token
        if(decoded.role !== 'leader') return res.status(403).json({error: "Forbidden: You are not the leader"});
        //pass user info to request.
        req.user = decoded; 
        next();

    } catch (error) {
        console.error('something wrong with auth middleware');
        res.status(500).json({ msg: 'Server Error' });
    }

}

//Export it to use it in index.js
module.exports = { verifyLeaderSession };