//Express
const express = require('express');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
//To generate unique Player IDs
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
//Apparently we have to get this because they separated from express.js 
var cookieParser = require('cookie-parser');
const cors = require('cors');


//middleauth imported
const { verifyLeaderSession } = require('./middleware');

var myApp = express();

//Cookies
myApp.use(cookieParser());

// Set the trust proxy setting - this should fix the iOS issue of not being able to set cookies..
myApp.set('trust proxy', 1); 

// Initialize Supabase client with your URL and API key
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

//Secret for JWT
const secret = process.env.JWT_SECRET;

//Table name
const tableName = 'game_sessions';
const foodTable = 'random_foods';

myApp.use(express.json());

//Allows CORS - Configure this once frontend is deployed to match the frontend domain.
myApp.use(cors({
    origin: process.env.URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
}));

async function fetchPlayerItems(playersFinalItems, foodBank) {
    //new empty JSON obj for calories sum for each player
    const playerCalories = {}

    for (const key of Object.keys(playersFinalItems)) {
        let accumulatedCalories = 0;
        console.log("Currently at " + key);
        for (const foodItem of playersFinalItems[key]) {

            //Check for null (This is if the user decides to AFK or runs out of time, anything thats not picked = 0)
            //Wait this could be used as a strat? (i.e someone who just wants to stop the calories count? smart)
            if (foodItem == null) {
                accumulatedCalories += 0;
            } else {
                const currentItemCalories = foodBank.find(food => food.name === foodItem.name)?.calories;

                if (foodItem === 'X') {
                    accumulatedCalories += 0;
                } else if (isNaN(currentItemCalories)) {
                    accumulatedCalories -= 9999;
                } else {
                    accumulatedCalories += currentItemCalories;
                }
            }

            // //Are they cheating ? (9999 reference to undertale)
            // if (isNaN(currentItemCalories) && foodItem !== 'X') {
            //     accumulatedCalories -= 9999;
            // } else {
            //     accumulatedCalories += currentItemCalories;
            // }

        }

        //set it
        playerCalories[key] = accumulatedCalories;


        //OLD
        // const { data, error } = await supabase
        //     .from('food_data')
        //     .select('name, calories')
        //     .in('name', playersFinalItems[key]);

        // if (error) {
        //     console.error("Error fetching food items", key, error);
        // } else {
        //     //Means we have the calories.. now just add them all!
        //     console.log("Food items for player", key, data);
        //     const totalCalories = data.reduce((sum, item) => sum + item.calories, 0);
        //     //Put it into the JSON - Altho here we are using player ID, but later on we may need to use player name,
        //     //players rather read their name than an abritrary ID.
        //     playerCalories[key] = totalCalories;
        // }
    }

    //Return once all players' calories are summed.
    return playerCalories;

}


//Create game
myApp.post('/createGame', async (req, res) => {
    try {
        //Game ID & Name 
        const { name, gameId, calories, timer } = req.body;

        //VALIDATIONS
        //Game ID must be (1000-9999)
        if (!gameId) return res.status(400).json({ error: "Game Id is not found? Try refreshing the Game Session ID." });
        if (isNaN(Number(gameId))) return res.status(400).json({ error: "Game Id should be only be 4 digits number." });

        if (!calories) return res.status(400).json({ error: "Please enter the Calories Goal." });
        if (isNaN(Number(calories))) return res.status(400).json({ error: "Calories must be a number." });

        if (!timer) return res.status(400).json({ error: "Please enter the Timer." });
        if (isNaN(Number(timer))) return res.status(400).json({ error: "Timer must be a number." });


        //const gameId = Math.floor(1000 + Math.random() * 9000);

        //Generate leader player ID
        const leaderID = uuidv4();

        //Fetch data like the X amount of food items that the host specified ? (i.e 6 choices x 6 levels = 36 foods)
        //Fetch random food items Default is 36.
        const { data: foods, error: foodsError } = await supabase
            .from(foodTable)
            .select("*")
            .limit(36);

        if (foodsError) {
            console.error("Supabase food error:", foodsError);
            throw error;
        }
        //This is the food items randomly chosen
        const selectedFoods = foods;

        //No special characters (1-10 chars)
        const nameRegex = /^[A-Za-z]{1,10}$/;
        const isNameValid = nameRegex.test(name);
        if (!isNameValid) return res.status(400).json({ error: "Name is not valid, name length must be 1-10 with no special characters." });

        const gameSession = {
            game_id: gameId,
            players: [{
                "player_id": leaderID, "name": name
            }],
            food_items: selectedFoods,
            selected_items: {},
            leader: leaderID,
            game_status: "WAITING",
            calories_goal: Number(calories),
            timer: Number(timer)
        };

        //Insert game session into database
        const { data, error } = await supabase
            .from(tableName)
            .insert([gameSession])
            .select();

        if (error) {
            console.error("Supabase error:", error);
            throw error;
        }

        // Generate the leader's session token (for security)
        const token = jwt.sign(
            { leaderID, game_id: gameId, role: 'leader' }, //The role is really for extra layer of security
            secret,
            { expiresIn: '2h' }
        );

        //OLD - Set the token as a secure HTTP-only cookie
        // res.cookie('leaderSession', token, { httpOnly: true, secure: true, sameSite: 'None', maxAge: 2 * 60 * 60 * 1000 });


        //Is data returned properly? - Can happen because of RLS (This is optional)
        if (!data || data.length === 0) {
            throw new Error("Supabase returned empty data after insertion");
        }

        //Respond with game session data
        res.status(201).json({
            message: "Game session created successfully",
            //Return data
            gameSession: data[0],
            //include generated player ID 
            leaderID,
            token
        });

    } catch (error) {
        console.error("Error creating game session: ", error.message);
        res.status(500).json({ error: "Failed to create game session.\n" + error.message });
    }
});

//Join game
myApp.post('/joinGame', async (req, res) => {

    try {
        //Game ID & Name 
        const { gameId } = req.body;
        let name = req.body.name;

        //Validate 
        if (gameId === "" || !name) {
            return res.status(400).json({ error: "Game ID and Name are required." });
        }

        if (!/^\d{4}$/.test(gameId)) {
            return res.status(400).json({ error: "Game Id should be exactly 4 digits." });
        }

        //Nicknames
        if (name.toLowerCase() == "majed") name = "Kitten";
        if (name.toLowerCase() == "yun") name = "Duck";
        if (name.toLowerCase() == "mohammed") name = "Monkey";
        if (name.toLowerCase() == "khaled") name = "Cat";

        // Generate a unique player ID
        const player_id = uuidv4();

        //I was not able to upsert as it was not properly working but here is how I will update records
        //First fetch the entire record.
        //Add the property we need (i.e in this case players list)
        //Update the entire row

        // Step 1: Retrieve the current players array
        const { data: existingGame, error: fetchError } = await supabase
            .from("game_sessions")
            .select("players, game_status")
            .eq("game_id", gameId)
            .single();

        if (!existingGame) return res.status(404).json({ error: "Game not found." });
        //Check if game already started (because we do not want the user to just jump in mid game LOL)
        if (existingGame.game_status !== "WAITING") return res.status(400).json({ error: "Sorry, but the game is either in progress or has ended. Play another!" });

        if (fetchError) throw fetchError;

        //Probably should store players' cap as a variable somewhere
        if (existingGame.players.length >= 4) return res.status(400).json({ error: "Party is already full. (4 players max)" });

        //Check if name already exists in game (we dont want 2 names in same game)
        const nameExists = existingGame.players.some(player => player.name === name);
        if (nameExists) {
            return res.status(400).json({ error: "A player with this name already exists " });
        }

        //Add the player to array
        const updatedPlayers = [
            ...existingGame.players,
            { player_id: player_id, name: name } // Add the new player
        ];

        //Update it
        const { data, error } = await supabase
            .from("game_sessions")
            .update({ players: updatedPlayers })
            .eq("game_id", gameId)
            .select();

        if (error) throw error;

        // Exclude the leader field using destructuring (user doesnt need to know whos leader - also easier for permissions on who can start game)
        const { leader, ...gameSessionWithoutLeader } = data[0];

        res.status(200).json({
            message: "Player joined the game successfully",
            // Return the selected data
            // gameSession: data[0],
            gameSession: gameSessionWithoutLeader,
            //include generated player ID 
            player_id
        });

    } catch (error) {
        console.error("Error joining game session: ", error.message);
        res.status(500).json({ error: "Failed to join game session" });
    }
});


//Start game - toggle game status from WAITING to STARTED
myApp.post('/startGame', verifyLeaderSession, async (req, res) => {

    //First check if it's leader initiating this.. If not deny them.
    //For security purposes, we will use JWT which is a session token mapping to the leader ID and stored in client's cookies
    //Without it, any user can modify their cookie to appear as the leader (NOT GOOD!)

    try {
        //Game ID 
        const { game_id } = req.body;

        if (!game_id) return res.status(400).json({ error: "Game ID is required." });

        // Fetch the player count for the given game ID
        // Assuming you have a way to count players in the session
        const { data: playerCount, error: playerCountError } = await supabase
            .from("game_sessions")
            .select('players')
            .eq("game_id", game_id);

        //Honestly remove this? I'll consult others regarding this......
        // if (playerCount[0].length < 2) {
        //     return res.status(400).json({ error: "You need at least 2 players to start the game." });
        // }

        // Update   
        const { data, error } = await supabase
            .from("game_sessions")
            .update({ game_status: "STARTED" })
            .eq("game_id", game_id)
            .select();

        if (error) {
            console.error("Error starting game:", error.message);
            return res.status(500).json({ error: "Failed to start game" });
        }

        res.status(200).json({
            message: "Game started successfully",
            gameStatus: data[0].game_status
        });
    } catch (error) {
        console.error("Error starting game: ", error.message);
        res.status(500).json({ error: "Failed to start game session" });
    }


});

//End game - so that users can't join a dead game, toggle game status from STARTED to FINISHED (archived basically)
myApp.post('/endGame', async (req, res) => {
    try {
        //Game ID 
        const { game_id } = req.body;

        if (!game_id) return res.status(400).json({ error: "Game ID is required." });

        // Update   
        const { data, error } = await supabase
            .from("game_sessions")
            .update({ game_status: "FINISHED" })
            .eq("game_id", game_id)
            .select();

        if (error) {
            console.error("Error ending game:", error.message);
            return res.status(500).json({ error: "Failed to end game" });
        }

        res.status(200).json({
            message: "Game ended successfully",
            gameStatus: data[0].game_status
        });
    } catch (error) {
        console.error("Error ending game: ", error.message);
        res.status(500).json({ error: "Failed to start game session" });
    }

});


//Submit Score - Users submit their scores then scores are compared, closest player to the calories goal without going over wins.
myApp.post('/submitScore', async (req, res) => {

    try {
        const { game_id, player_id, selected_items } = req.body;

        //Player_id may not be needed here since it is technically inside of selected_items
        if (!game_id || !player_id || !selected_items) {
            return res.status(400).json({ error: "One of the variables game ID, player ID and user selected items are null." });
        }

        // Step 1: Retrieve the current players array
        const { data: existingGame, error: fetchError } = await supabase
            .from("game_sessions")
            .select("selected_items, players, food_items, winner")
            .eq("game_id", game_id)
            .single();


        //Add the new content to the selected column
        //This can be a problem unfortunately if two or more people happen to submit their score at same time, we get "racing conditions",
        //I may need to think of a new way to do this.
        const updatedItemsByPlayers = {
            ...existingGame.selected_items,
            [player_id]: [
                ...selected_items
            ]
        };

        //Update it
        const { data: updatedData, error: updatedError } = await supabase
            .from("game_sessions")
            .update({ selected_items: updatedItemsByPlayers })
            .eq("game_id", game_id)
            .select();

        if (updatedError) throw error;

        //Force a fetch again (Honestly unsure why I could not use 'existingGame') - I have to analyze this further.. 
        //I do not want to call the backend more times than I should..
        // const { data: refreshedGame, error: refetchError } = await supabase
        //     .from("game_sessions")
        //     .select("selected_items, players, food_items, winner")
        //     .eq("game_id", game_id)
        //     .single();

        // if (refetchError) throw refetchError;

        //If selected_items == # of players then the game is FINISHED!
        //Could add layer of security to see if player ids from selected items == player ids from players (maybe?)
        console.log(updatedData);
        console.log(updatedData[0].players.length);

        if (Object.keys(updatedData[0].selected_items).length >= updatedData[0].players.length) {
            //EVeryone has submitted!
            //fetch everyone's items and calculate the total calories.
            const playersFinalItems = updatedData[0].selected_items;
            //Our chance to save to "original_players" for record keeping as players will be changed.
            const { error: OGPlayersError } = await supabase
                .from("game_sessions")
                .update({ original_players: updatedData[0].players })
                .eq("game_id", game_id)
                .select();

            if (OGPlayersError) throw OGPlayersError;

            //new
            const playersFinalCalories = await fetchPlayerItems(playersFinalItems, updatedData[0].food_items);
            console.log("here?");
            console.log(playersFinalCalories);
            //Now submit it to Winner column
            const { data, error } = await supabase
                .from("game_sessions")
                .update({ winner: playersFinalCalories })
                .eq("game_id", game_id)
                .select();

        }
        //I may or may not need this (if I will be listening to winner column)
        const winner = existingGame.winner;

        res.status(200).json({
            message: "Player's items have been submitted successfully",
            // Return the selected data
            gameSession: updatedData[0],
            //include generated player ID  (Optional since data[0] is sufficient)
            player_id,
            selected_items,
            winner
        });

    } catch (error) {

        console.error("Error submitting player's items: ", error.message);
        res.status(500).json({ error: "Failed to submit player's items and calculate score" });

    }
});

//Remove a player from the game (if they happen to leave the game or something)
//I'll need to add some sort of authentication to prevent misuse (i.e someone kicks someone else)
myApp.post('/leaveGame', async (req, res) => {
    const { game_id, player } = req.body;

    console.log(game_id);
    console.log(player);

    //Logic to remove it - Retrieve through SELECT, Omit the player out of list, UPDATE the players list to Supabase DB
    const { data: existingGame, error: fetchError } = await supabase
        .from('game_sessions')
        .select('players')
        .eq('game_id', game_id)
        .single();


    //This validation may not be necessary but nonetheless enforce it for better security
    if (fetchError || !existingGame) return res.status(404).json({ error: "Game not found." });
    console.log(existingGame.players);

    //Update - filter out the player basically.
    const updatedPlayers = existingGame.players.filter(currentPlayer => currentPlayer.player_id !== player.player_id);

    console.log(updatedPlayers);

    const { data, error: updateError } = await supabase
        .from('game_sessions')
        .update({ players: updatedPlayers })
        .eq('game_id', game_id);

    if (updateError) {
        return res.status(500).json({ error: "Problem occurred with removing a player." });
    }

    //success
    res.status(200).json({ message: "Player removed successfully." });

});


//Rematch - Only leaders can rematch
myApp.post('/rematch', verifyLeaderSession, async (req, res) => {

    try {
        //Game ID & Name 
        const { gameId } = req.body;

        //Validate 
        if (gameId === "") {
            return res.status(400).json({ error: "Game ID and Name are required." });
        }

        if (!/^\d{4}$/.test(gameId)) {
            return res.status(400).json({ error: "Game Id should be exactly 4 digits." });
        }

        //Fetch random food items Default is 36.
        const { data: foods, error: foodsError } = await supabase
            .from(foodTable)
            .select("*")
            .limit(36);

        if (foodsError) {
            console.error("Supabase food error:", foodsError);
            throw error;
        }

        //Here is what we need to reset
        //food_items regen, selected_items cleared, game_status set to WAITING, winner reset to NULL, rematch_counter +1
        //Update the variables..
        const { error: updateError } = await supabase
            .from("game_sessions")
            .update({ selected_items: {}, food_items: foods, game_status: "WAITING", winner: null })
            .eq("game_id", gameId);

        if (updateError) throw updateError;

        const { error: rpcError } = await supabase
            .rpc('increment_rematch_counter', { game_id: gameId });


        //Once all is updated, lets select it so that the host gets copy of the new data
        //Non-leader/host players dont need this, as they recieve live updates instead

        //  Retrieve the data
        const { data: newData, error: newDataError } = await supabase
            .from("game_sessions")
            .select("selected_items, food_items, game_status, winner, rematch_counter")
            .eq("game_id", gameId)
            .single();

        res.status(200).json({
            message: "Game successfully restarted!",
            gameSession: newData,
        });

    } catch (error) {
        console.error("Error restarting game session: ", error.message);
        res.status(500).json({ error: "Failed to restart game session" });
    }
});





//BELOW IS A TEST & CAN BE REMOVED
//Get Game Results - Post the results of players with their calories score in a table form
//This was really cool but basically I made a SQL view that would order randomly the food items,
//so I just need to pick the first X items and I am good!
// myApp.get('/getGameResults', async (req, res) => {
//     const foodSelection = ["Apple", "Banana", "Kale", "Chicken", "Fig", "Peanuts"];

//     try {
//         //Dont think this is best way to do it because we're a) searching through all food items b) user could cheat and put foods they want
//         //Originally wanted to look into the "game_sessions"'s "food_items", but unfortunately that's a JSON. If this solution doesn't work, I'll reconsider
//         const { data, error } = await supabase
//             .from('food_data')
//             .select('name, calories')
//             .in('name', foodSelection);

//         res.status(200).json({
//             message: "Here are your items",
//             // Return the selected data
//             gameSession: data,

//         });
//     } catch (error) {
//         console.error("Error fetching food items: ", error.message);
//         res.status(500).json({ error: "Failed to fetch food items" });
//     }

//     const { data, error } = await supabase
//         .from(foodTable)
//         .select("*")
//         .limit(36);

//     if (error) {
//         console.error("Error fetching food items:", error);
//         res.status(500).send({ error: "Failed to fetch food items" });
//     } else {
//         console.log("Random food items:", data);
//         res.send(data);  // Send data back to the client
//     }
// });


//Generate the DB of food items
// Disable RLS for this operation 
// myApp.post('/addFoods', async (req, res) => {
//     try {
//         const { data, error } = await supabase
//             .from("food_data")
//             .insert(FoodItems);

//         console.log("Food items inserted successfully:", data);

//     } catch (error) {
//         console.error("Error inserting food items:", error);

//     }

// });


//Show we are runnin
const PORT = process.env.PORT || 8080;
myApp.listen(PORT, () => console.log(`Server running`));