# Backend for [CaloriesJack](https://github.com/KhaledHadida/CaloriesJack)

## Notes before starting

In Supabase you will need to create a [RPC](https://supabase.com/docs/reference/javascript/rpc) (Remote Procedure Call) to increment a column for whenever a player decides to rematch.
To do this:
1. Navigate to your [project](https://supabase.com/dashboard) in Supabase.
2. From the left hand side panel, navigate to **SQL Editor**
3. Next to the Search queries search bar click the '+' and Create a new snippet to create your SQL query.
4. Paste in the following code and run it.
```
create function increment_rematch_counter(game_id int2)
returns void as
$$
update game_sessions
set rematch_counter = rematch_counter + 1
where game_id = $1;
$$
language sql volatile;
```

You will also need to generate the food items bank in Supabase, this is where all in game food items are fetched from. 
To do this:
1. In the backend (or frontend) there is FoodItems.js, ensure it is imported in index.js.
2. Temporarily disable [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) by going to Authentication -> Policies in Supabase.
3. Uncomment the `/addFoods` POST request found at the end of index.js.
4. You can use POSTMAN or simply call it through the backend by making a request to `/addFoods` from the frontend.
5. Re-enable RLS.

Please make sure that table names in your index.js correspond to the tables found in your Supabase. 

These are the default names:
```
//Table name
const tableName = 'game_sessions';
const foodTable = 'random_foods';
```

## How to Run Locally

1. Clone the Repository

```
git clone https://github.com/KhaledHadida/CaloriesJack-Backend.git 
cd CaloriesJack-Backend
```

2. Set up your .env file in src folder with Supabase variables (You will need to create a Supabase project to retrieve [anon key & URL](https://supabase.com/docs/guides/api))

```
SUPABASE_URL="YOUR URL HERE"
JWT_SECRET="PICK A GOOD SECRET STRING"
URL="http://localhost:3000"
SUPABASE_KEY="YOUR ANON KEY HERE"
```

3. Install Dependencies & Start the Backend Development Server

```
npm install
npm start
```

Running the frontend is optional here.

