const express = require("express");
const app = express();
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
app.use(express.json());
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

//MiddleWare Function

const authentication = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (authHeader === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_PRACTICE_SESSION", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        request.name = payload.name;
        next();
      }
    });
  }
};
// MiddleWare function

const tweetAccessVerification = async (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request;
  const userDetailsQuery = `SELECT * FROM user WHERE 
  username = '${username}';`;
  const userDetails = await db.get(userDetailsQuery);
  const { name, gender, user_id } = userDetails;
  const getTweetQuery = `SELECT * FROM 
  tweet INNER JOIN follower on
  tweet.user_id=
    follower.following_user_id WHere tweet.tweet_id =
    ${tweetId} AND follower_user_id = ${user_id};`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//Register USER API
app.post("/register/", async (request, response) => {
  const { name, username, password, gender } = request.body;
  const checkUserQuery = `SELECT * FROM user where username = '${username}';`;
  const checkInDb = await db.get(checkUserQuery);
  if (checkInDb !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const registerUserQuery = `INSERT INTO user (name,username,password,gender)
            VALUES(
                '${name}',
                '${username}',
                '${hashedPassword}',
                '${gender}'
            );`;
      await db.run(registerUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

const getFollowingPeopleIdsOfUser = async (username) => {
  const getTheFollowingPeopleQuery = `
    SELECT following_user_id FROM follower
    INNER JOIN user ON user.user_id = 
    follower_user_id WHERE user.username = 
    '${username}';`;
  const followingPeople = await db.all(getTheFollowingPeopleQuery);
  const arrayOfIds = followingPeople.map(
    (eachUser) => eachUser.following_user_id
  );
  return arrayOfIds;
};
//Login API

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const isAlreadyUserQuery = `
    SELECT * FROM user WHERE username = '${username}';
    `;
  const dbUser = await db.get(isAlreadyUserQuery);
  const { user_id, name } = dbUser;
  //   console.log(dbUser);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    let isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === false) {
      response.status(400);
      response.send("Invalid password");
    } else {
      const payload = {
        username: username,
        userId: user_id,
        name: name,
      };
      //   console.log(payload);
      const jwtToken = jwt.sign(payload, "MY_PRACTICE_SESSION");
      response.send({ jwtToken });
    }
  }
});

//Returns the latest tweets of people whom the user follows. Return 4 tweets at a time

app.get("/user/tweets/feed/", authentication, async (request, response) => {
  const { username } = request;
  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username);
  const getTweetsQuery = `SELECT username,tweet,date_time as dateTime
     FROM user INNER JOIN tweet ON user.user_id 
     = tweet.user_id
     WHERE user.user_id In (${followingPeopleIds})
     ORDER BY date_time DESC
     LIMIT 4;`;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

//Returns the list of all names of people whom the user follows

app.get("/user/following/", authentication, async (request, response) => {
  const { username, userId } = request;
  const getTweetsQuery = `SELECT name FROM 
    follower INNER JOIN user
     ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${userId}`;
  const followingIdQuery = await db.all(getTweetsQuery);
  response.send(followingIdQuery);
});

//Returns the list of all names of people who follows the user

app.get("/user/followers/", authentication, async (request, response) => {
  const { username, userId } = request;
  const getTweetsQuery = `SELECT DISTINCT name FROM 
    user INNER JOIN follower
     ON user.user_id = follower.follower_user_id
    WHERE follower.following_user_id = ${userId}`;
  const followingIdQuery = await db.all(getTweetsQuery);
  response.send(followingIdQuery);
});

//User requests a tweet API
app.get(
  "/tweets/:tweetId/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const getTweetDetailsQuery = `SELECT tweet,
  (SELECT COUNT() from like where tweet_id = ${tweetId}) AS likes, 
  (select COUNT() from reply where tweet_id = ${tweetId}) AS replies,
  date_time AS dateTime
  FROM tweet
    WHERE tweet.tweet_id = ${tweetId};`;
    const tweetDetails = await db.get(getTweetDetailsQuery);
    response.send(tweetDetails);
  }
);

//User requests a tweet of a user he is following

app.get(
  "/tweets/:tweetId/likes/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetDetailsQuery = `SELECT username
    FROM user INNER JOIN like ON user.user_id
    = like.user_id WHERE tweet_id = '${tweetId}'`;
    const tweetDetails = await db.all(getTweetDetailsQuery);
    const usersArray = tweetDetails.map((eachUser) => eachUser.username);
    response.send({ likes: usersArray });
  }
);

//User requests a tweet of a user he is following

app.get(
  "/tweets/:tweetId/replies/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetDetailsQuery = `SELECT name, reply
    FROM 
    user INNER JOIN reply  
    ON reply.user_id = user.user_id 
    WHERE tweet_id = ${tweetId};`;
    const tweetDetails = await db.all(getTweetDetailsQuery);
    response.send({ replies: tweetDetails });
  }
);

//Returns a list of all tweets of the user

app.get("/user/tweets/", authentication, async (request, response) => {
  const { username, userId } = request;
  const getTweetDetailsQuery = `SELECT
    tweet,
    COUNT(DISTINCT(like_id)) as likes,
    COUNT(DISTINCT(reply_id)) as replies,
    date_time as dateTime
    FROM 
    tweet LEFT JOIN reply
    ON reply.tweet_id = tweet.tweet_id 
    LEFT JOIN like
    ON like.tweet_id = tweet.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`;
  const tweetDetails = await db.all(getTweetDetailsQuery);
  response.send(tweetDetails);
});

//Post a tweet API

app.post("/user/tweets/", authentication, async (request, response) => {
  const { username, userId } = request;
  const postTweetQuery = `
      INSERT INTO tweet (tweet,user_id)
      VALUES('${tweet}',${userId});
      `;
  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

//DELETE a tweet API

app.delete("/tweets/:tweetId/", authentication, async (request, response) => {
  const { username, userId } = request;
  const { tweetId } = request.params;
  const checkIfMyTweetQuery = `SELECT * FROM tweet where tweet_id = ${tweetId}
                                    AND user_id = ${userId};`;
  const isThereInAccount = await db.get(checkIfMyTweetQuery);
  if (isThereInAccount !== undefined) {
    const deleteTweetQuery = `DELETE FROM tweet
                              WHERE tweet_id = ${tweetId};`;

    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

module.exports = app;
