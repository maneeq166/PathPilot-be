const { checkUserExists, createUser,  checkPassword, signAccessToken, createToken, updateUser, deleteUser, checkUser, checkByUsername, checkById, checkAllUser } = require("../../repositories/auth");
const bcrypt = require("bcrypt");

exports.registerUser = async (username,password,email) =>{
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
    

    user = await createUser(username,hashedPassword,email);

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

    let token = createToken(user._id,user.username,user.email);

    return {
        data:token,
        message:"Logged In!",
        statusCode:200
    }
}


exports.readUser = async (email,username)=>{
    if(!data){
        return {
            data:null,
            message:"Required fields are missing",
            statusCode:400
        }
    }

    let user;

    if(email){
        user = await checkUser(email);
    }else if(username){
        user = await checkByUsername(username);
    }else {
        user = await checkAllUser();
    }

    return {
        data:user,
        message:"Fetched Information",
        statusCode:200
    }
}

exports.readSingleUser = async (id)=>{
    if(!id){
        return {
            data:null,
            message:"Required fields are missing",
            statusCode:400
        }
    }

    let user = await checkById(id);

    if(!user){
        return {
            data:null,
            message:"User does not exist",
            statusCode:400
        }
    }

    return {
        data:user,
        message:"User exists",
        statusCode:200
    }
}


exports.updatedUser = async (id,data)=>{
    if(!id||!data){
        return {
            data:null,
            message:"Required fields are missing",
            statusCode:400
        }
    }

    if(data.role){
        delete data.role;
    }

    let user = await updateUser(id,data);


    if(!user){
        return {
            data:null,
            message:"Something went wrong",
            statusCode:400
        }
    }

    return {
        data:user,
        message:"User updated",
        statusCode:200
    }
}

exports.deletedUser = async (id)=>{
    if(!id){
        return {
            data:null,
            message:"Required fields are missing",
            statusCode:400
        }
    }

    let user = await deleteUser(id);

    if(!user){
        return{
            data:null,
            message:"Something went wrong",
            statusCode:400
        }
    }

    return {
        data:user,
        message:"User deleted",
        statusCode:200
    }
}