const mongoose = require("mongoose");

const userSchema = mongoose.Schema({
    username:{type:String,required:true},
    email:{type:String,required:true,unique:true},
    role:{type:String,required:true,enum:["user","admin"],default:"user"},
    password:{type:String,required:true},
    profilePicture:{type:String}
})

const User = mongoose.model("user",userSchema);

module.exports = {User};