const { checkUserExists, createUser, createJwt, checkPassword } = require("../../repositories/auth");
const bcrypt = require("bcrypt");

exports.registerUser = async (username,password,email,profilePicture) =>{
    if(!username||!password||!email){
        return {
            data:null,
            message:"Required fields are missing",
            statusCode:400
        }
    }

    let user = await checkUserExists(email);

    if(user){
        return {
            data:null,
            message:"Something went wrong",
            statusCode:400
        }
    }

    let hashedPassword = await bcrypt.hash(password,10);

    user = await createUser(username,hashedPassword,email,profilePicture);

    if(!user){
        return {
            data:null,
            message:"Couldn't create user",
            statusCode:400
        }
    }

    return {
        data:null,
        message:"User registered!",
        statusCode:201
    }
}

exports.loginUser = async(email,password) =>{
    if(!email || !password){
        return {
            data:null,
            message:"Required fields are missing",
            statusCode:400
        }
    }

    let user = await checkUserExists(email);

    if(!user){
        return {
            data:null,
            message:"Account doesnt Exist",
            statusCode:400
        }
    }

    let correctPassword = await checkPassword(password,user.password);

    if(!correctPassword){
        return {
            data:null,
            message:"Something went wrong",
            statusCode:400
        }
    }

    let token = await createJwt(user._id,user.role);

    return {
        data:token,
        message:"Logged In!",
        statusCode:200
    }
}