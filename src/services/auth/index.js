const { checkUserExists, createUser } = require("../../repositories/auth")

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

    user = await createUser(username,password,email,profilePicture);

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