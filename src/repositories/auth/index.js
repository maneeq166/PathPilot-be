const { env } = require("../../config/env");
const { User } = require("../../models/userModel");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

exports.createUser = async (username,password,email,profilePicture) =>{
    return await User.create({username,password,email,profilePicture});
}

exports.checkUserExists = async (email) =>{
    return await User.findOne({email});
}

exports.createJwt = async (id,role) =>{
    return jwt.sign({id:id,role:role},env.JWT_SECRET);
}

exports.checkPassword = async (password,hashedPass)=>{
    return await bcrypt.compare(password,hashedPass)
}

