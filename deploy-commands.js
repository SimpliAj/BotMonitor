const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Starts the Status Monitor'),

  new SlashCommandBuilder()
    .setName('stop_status')
    .setDescription('Stops the Status Monitor'),

  new SlashCommandBuilder()
    .setName('help_status')
    .setDescription('Shows help for the Status Monitor'),

  new SlashCommandBuilder()
    .setName('add_bot')
    .setDescription('Adds a bot to this server\'s monitoring list')
    .addStringOption(option =>
      option
        .setName('bot_id')
        .setDescription('The ID of the bot to add')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('remove_bot')
    .setDescription('Removes a bot from this server\'s monitoring list')
    .addStringOption(option =>
      option
        .setName('bot_id')
        .setDescription('The ID of the bot to remove')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('list_bots')
    .setDescription('Shows all monitored bots on this server'),
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function deployCommands() {
  try {
    // Validiere .env Variablen
    if (!process.env.DISCORD_TOKEN) {
      throw new Error('DISCORD_TOKEN ist nicht in der .env Datei definiert!');
    }

    if (!process.env.CLIENT_ID) {
      throw new Error('CLIENT_ID ist nicht in der .env Datei definiert! Füge CLIENT_ID=DEINE_CLIENT_ID hinzu.');
    }

    console.log('🔄 Registriere Slash-Commands...');
    console.log(`Client ID: ${process.env.CLIENT_ID}`);

    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands,
    });

    console.log('✅ Slash-Commands erfolgreich registriert!');
  } catch (error) {
    console.error('❌ Fehler beim Registrieren der Commands:');
    console.error(error.message);
    if (error.rawError) {
      console.error('Discord API Fehler:', error.rawError);
    }
    process.exit(1);
  }
}

deployCommands();
