const { Client, GatewayIntentBits, ChannelType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
  ],
});

// Bot IDs zum Überwachen (aus .env)
let BOT_IDS = (process.env.BOT_IDS || '').split(',').map(id => id.trim()).filter(id => id);

// User ID für Offline-Benachrichtigungen (aus .env)
const ALERT_USER_ID = process.env.ALERT_USER_ID;

// Persistierungs-Dateien
const CONFIG_FILE = path.join(__dirname, 'status-monitor-config.json');
const BOTS_FILE = path.join(__dirname, 'monitored-bots.json');

// Lade überwachte Bot-IDs
function loadMonitoredBots() {
  try {
    if (fs.existsSync(BOTS_FILE)) {
      const data = fs.readFileSync(BOTS_FILE, 'utf8');
      const loadedBots = JSON.parse(data);
      if (Array.isArray(loadedBots) && loadedBots.length > 0) {
        BOT_IDS = loadedBots;
        console.log(`✅ ${BOT_IDS.length} überwachte Bots geladen`);
      }
    }
  } catch (error) {
    console.error('Fehler beim Laden der Bot-IDs:', error);
  }
}

// Speichere überwachte Bot-IDs
function saveMonitoredBots() {
  try {
    fs.writeFileSync(BOTS_FILE, JSON.stringify(BOT_IDS, null, 2));
    console.log(`💾 ${BOT_IDS.length} Bot-IDs gespeichert`);
  } catch (error) {
    console.error('Fehler beim Speichern der Bot-IDs:', error);
  }
}

// Globale Variablen für das Embed
let statusMessage = null;
let statusChannel = null;
let updateInterval = null;

// Globale Variablen für Status-Tracking
let previousBotStatuses = {};
let alertedBots = {}; // Verhindert mehrfache Alerts für den gleichen Bot
let botOfflineTimes = {}; // Speichert wann ein Bot offline ging

// Lade gespeicherte Konfiguration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Fehler beim Laden der Konfiguration:', error);
  }
  return null;
}

// Speichere Konfiguration
function saveConfig(channelId, messageId, guildId) {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ channelId, messageId, guildId }, null, 2)
    );
  } catch (error) {
    console.error('Fehler beim Speichern der Konfiguration:', error);
  }
}

// Lösche gespeicherte Konfiguration
function deleteConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  } catch (error) {
    console.error('Fehler beim Löschen der Konfiguration:', error);
  }
}

client.once('ready', () => {
  console.log(`✅ Bot ist online als ${client.user.tag}`);

  // Lade überwachte Bots
  loadMonitoredBots();

  // Versuche, den Status-Monitor nach einem Restart wiederherzustellen
  restoreStatusMonitor();
});

// Stelle den Status-Monitor wieder her, falls eine Konfiguration gespeichert ist
async function restoreStatusMonitor() {
  try {
    const config = loadConfig();
    if (!config) {
      console.log('ℹ️  Keine gespeicherte Status-Monitor Konfiguration gefunden.');
      return;
    }

    console.log(`📝 Gespeicherte Config gefunden: Guild=${config.guildId}, Channel=${config.channelId}, Message=${config.messageId}`);

    const guild = await client.guilds.fetch(config.guildId);
    if (!guild) {
      console.error(`❌ Guild ${config.guildId} nicht gefunden. Konfiguration wird gelöscht.`);
      deleteConfig();
      return;
    }

    console.log(`✓ Guild gefetcht: ${guild.name}`);

    const channel = await guild.channels.fetch(config.channelId);
    if (!channel) {
      console.error(`❌ Channel ${config.channelId} nicht gefunden. Konfiguration wird gelöscht.`);
      deleteConfig();
      return;
    }

    console.log(`✓ Channel gefetcht: ${channel.name}`);

    try {
      const message = await channel.messages.fetch(config.messageId);
      if (!message) {
        throw new Error('Nachricht nicht gefunden');
      }

      statusMessage = message;
      statusChannel = channel;

      console.log(
        `✅ Status-Monitor wiederhergestellt! Aktualisiere Embed in ${channel.name}`
      );

      // Starte das Update Interval
      if (updateInterval) clearInterval(updateInterval);
      startUpdateInterval(guild);
    } catch (messageError) {
      console.warn('⚠️  Alte Nachricht nicht auffindbar, erstelle neue...');
      console.warn(`Error Details: ${messageError.message}`);
      
      try {
        // Versuche alte Messages zu löschen (wenn die alte nicht mehr auffindbar ist)
        try {
          // Fetche die letzten 100 Messages im Channel
          const messages = await channel.messages.fetch({ limit: 100 });
          
          // Lösche alle Status Monitor Embeds
          let deletedCount = 0;
          for (const msg of messages.values()) {
            if (msg.embeds.length > 0 && msg.embeds[0].title === '🤖 Bot Status Monitor') {
              try {
                await msg.delete();
                deletedCount++;
              } catch (delError) {
                console.warn(`⚠️  Konnte Message nicht löschen: ${delError.message}`);
              }
            }
          }
          
          if (deletedCount > 0) {
            console.log(`🗑️  ${deletedCount} alte Status Monitor Message(s) gelöscht`);
          }
        } catch (cleanupError) {
          console.warn(`⚠️  Konnte alte Messages nicht aufräumen: ${cleanupError.message}`);
        }
        
        // Erstelle eine neue Message im selben Channel
        const embed = createStatusEmbed(guild);
        statusMessage = await channel.send({ embeds: [embed] });
        statusChannel = channel;
        
        // Speichere die neue Message ID
        saveConfig(channel.id, statusMessage.id, guild.id);
        
        console.log(`✅ Neue Status-Monitor Nachricht erstellt!`);
        
        // Starte das Update Interval
        if (updateInterval) clearInterval(updateInterval);
        startUpdateInterval(guild);
      } catch (createError) {
        console.error('❌ Fehler beim Erstellen einer neuen Message:', createError.message);
        deleteConfig();
      }
    }
  } catch (error) {
    console.error('Fehler beim Wiederherstellen des Status-Monitors:', error.message);
    deleteConfig();
  }
}

// Sende DM an User wenn ein Bot offline geht
async function sendOfflineAlert(botName, botId) {
  try {
    console.log(`⏳ Versuche DM zu senden für Bot ${botName}...`);
    const user = await client.users.fetch(ALERT_USER_ID);
    console.log(`✓ User gefetcht: ${user.tag}`);
    
    // Fetche den Bot um sein Profielbild zu bekommen
    let botAvatarUrl = null;
    try {
      const botUser = await client.users.fetch(botId);
      botAvatarUrl = botUser.displayAvatarURL({ dynamic: true, size: 256 });
    } catch (botFetchError) {
      console.warn(`⚠️  Konnte Bot-Avatar nicht laden: ${botFetchError.message}`);
    }
    
    // Speichere die Offline-Zeit
    botOfflineTimes[botId] = new Date();
    
    const alertEmbed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('🔴 Bot Offline!')
      .setDescription(`A bot went offline`)
      .addFields(
        {
          name: '🤖 Bot Name',
          value: botName,
          inline: false,
        },
        {
          name: '⏰ Timestamp',
          value: new Date().toLocaleString('en-US'),
          inline: false,
        }
      )
      .setFooter({ text: 'Status Monitor Alert' });
    
    // Setze das Thumbnail wenn verfügbar
    if (botAvatarUrl) {
      alertEmbed.setThumbnail(botAvatarUrl);
    }

    await user.send({ embeds: [alertEmbed] });
    console.log(`📬 DM an User ${ALERT_USER_ID} gesendet - Bot ${botName} ist offline`);
  } catch (error) {
    console.error(`❌ Fehler beim Senden der Offline-DM für Bot ${botName}:`, error.message);
    if (error.code) {
      console.error(`Discord Error Code: ${error.code}`);
    }
  }
}

// Sende DM an User wenn ein Bot wieder online geht
async function sendOnlineAlert(botName, botId) {
  try {
    console.log(`⏳ Versuche Online-DM zu senden für Bot ${botName}...`);
    const user = await client.users.fetch(ALERT_USER_ID);
    console.log(`✓ User gefetcht: ${user.tag}`);
    
    // Fetche den Bot um sein Profielbild zu bekommen
    let botAvatarUrl = null;
    try {
      const botUser = await client.users.fetch(botId);
      botAvatarUrl = botUser.displayAvatarURL({ dynamic: true, size: 256 });
    } catch (botFetchError) {
      console.warn(`⚠️  Konnte Bot-Avatar nicht laden: ${botFetchError.message}`);
    }
    
    // Berechne die Downtime
    let downtimeDuration = 'Unbekannt';
    if (botOfflineTimes[botId]) {
      const offlineTime = botOfflineTimes[botId];
      const now = new Date();
      const diffMs = now - offlineTime;
      
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
      
      if (hours > 0) {
        downtimeDuration = `${hours}h ${minutes}m ${seconds}s`;
      } else if (minutes > 0) {
        downtimeDuration = `${minutes}m ${seconds}s`;
      } else {
        downtimeDuration = `${seconds}s`;
      }
    }
    
    const alertEmbed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('🟢 Bot Online!')
      .setDescription(`A bot came back online`)
      .addFields(
        {
          name: '🤖 Bot Name',
          value: botName,
          inline: false,
        },
        {
          name: '⏱️ Downtime Duration',
          value: downtimeDuration,
          inline: false,
        },
        {
          name: '⏰ Timestamp',
          value: new Date().toLocaleString('en-US'),
          inline: false,
        }
      )
      .setFooter({ text: 'Status Monitor Alert' });
    
    // Setze das Thumbnail wenn verfügbar
    if (botAvatarUrl) {
      alertEmbed.setThumbnail(botAvatarUrl);
    }

    await user.send({ embeds: [alertEmbed] });
    console.log(`📬 DM an User ${ALERT_USER_ID} gesendet - Bot ${botName} ist wieder online`);
    
    // Lösche die Offline-Zeit nach dem Alert
    delete botOfflineTimes[botId];
  } catch (error) {
    console.error(`❌ Fehler beim Senden der Online-DM für Bot ${botName}:`, error.message);
    if (error.code) {
      console.error(`Discord Error Code: ${error.code}`);
    }
  }
}

function startUpdateInterval(guild) {
  // Initialisiere previousBotStatuses beim ersten Start
  if (Object.keys(previousBotStatuses).length === 0) {
    const statuses = getbotStatuses(guild);
    previousBotStatuses = JSON.parse(JSON.stringify(statuses));
    console.log('✅ Initiale Bot-Status gespeichert');
  }

  updateInterval = setInterval(async () => {
    try {
      if (statusMessage && statusChannel) {
        // Versuche Guild-Daten zu aktualisieren mit Timeout
        try {
          await Promise.race([
            guild.members.fetch(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Members fetch timeout')), 5000)
            )
          ]);
        } catch (fetchError) {
          console.warn('⚠️  Guild members fetch timeout - verwende Cache');
          // Fallback: Nutze den Cache wenn fetch fehlschlägt
        }
        
        const statuses = getbotStatuses(guild);
        
        // Prüfe auf Statusänderungen (Offline-Alerts)
        for (const botId of BOT_IDS) {
          const currentStatus = statuses[botId];
          const previousStatus = previousBotStatuses[botId];
          
          console.log(`[Status Check] ${currentStatus.name}: vorher=${previousStatus?.online}, jetzt=${currentStatus.online}`);
          
          // Wenn Bot online war und jetzt offline ist
          if (previousStatus && previousStatus.online && !currentStatus.online && !alertedBots[botId]) {
            console.log(`⚠️  Bot ${currentStatus.name} ist offline gegangen!`);
            await sendOfflineAlert(currentStatus.name, botId);
            alertedBots[botId] = true; // Verhindere mehrfache Alerts
          }
          
          // Wenn Bot offline war und jetzt wieder online ist
          if (previousStatus && !previousStatus.online && currentStatus.online) {
            console.log(`✅ Bot ${currentStatus.name} ist wieder online!`);
            await sendOnlineAlert(currentStatus.name, botId);
            delete alertedBots[botId]; // Reset den Alert-Status
          }
        }
        
        // Speichere den aktuellen Status für den nächsten Check
        previousBotStatuses = JSON.parse(JSON.stringify(statuses));
        
        const newEmbed = createStatusEmbed(guild);
        await statusMessage.edit({ embeds: [newEmbed] });
        console.log('📊 Status Embed aktualisiert um ' + new Date().toLocaleTimeString('de-DE'));
      } else {
        console.warn('⚠️  statusMessage oder statusChannel ist null - Monitor läuft nicht');
      }
    } catch (error) {
      console.error('❌ Fehler beim Aktualisieren des Embeds:', error.message);
      console.error('Error Details:', error);
      
      // Stoppe nur beim Fehler, aber gib dem Benutzer eine Chance zu erkennen, was falsch ist
      if (error.code === 10008) {
        // Nachricht wurde gelöscht
        console.error('📍 Die Status-Monitor Nachricht wurde gelöscht. Monitor wird gestoppt.');
        deleteConfig();
        if (updateInterval) clearInterval(updateInterval);
      } else if (error.code === 50013) {
        // Fehlende Berechtigung
        console.error('📍 Fehlende Berechtigung zum Bearbeiten der Nachricht. Monitor wird gestoppt.');
        deleteConfig();
        if (updateInterval) clearInterval(updateInterval);
      }
      // Für andere Fehler: ignorieren und beim nächsten Durchlauf erneut versuchen
    }
  }, 60000); // 60 Sekunden
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'status') {
    await handleStatusCommand(interaction);
  } else if (commandName === 'stop_status') {
    await handleStopStatusCommand(interaction);
  } else if (commandName === 'help_status') {
    await handleHelpCommand(interaction);
  } else if (commandName === 'add_bot') {
    await handleAddBotCommand(interaction);
  } else if (commandName === 'remove_bot') {
    await handleRemoveBotCommand(interaction);
  } else if (commandName === 'list_bots') {
    await handleListBotsCommand(interaction);
  }
});

async function handleStatusCommand(interaction) {
  try {
    statusChannel = interaction.channel;

    const embed = createStatusEmbed(interaction.guild);
    
    // Sende die Nachricht direkt in den Channel statt über Interaction
    // Das verhindert Webhook Token Fehler
    statusMessage = await statusChannel.send({ embeds: [embed] });

    // Speichere Konfiguration
    saveConfig(
      statusChannel.id,
      statusMessage.id,
      interaction.guild.id
    );

    // Starte das Update Interval
    if (updateInterval) clearInterval(updateInterval);
    startUpdateInterval(interaction.guild);

    // Sende eine Bestätigungsnachricht
    await interaction.reply('✅ Status Monitor started! The embed will be updated every 60 seconds.');
  } catch (error) {
    console.error(error);
    await interaction.reply('❌ Error starting the monitor.');
  }
}

async function handleStopStatusCommand(interaction) {
  try {
    if (statusMessage) {
      await statusMessage.delete();
      statusMessage = null;
      statusChannel = null;

      if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
      }

      // Lösche gespeicherte Konfiguration
      deleteConfig();

      await interaction.reply('✅ Status Monitor stopped and message deleted.');
    } else {
      await interaction.reply('❌ No active Status Monitor.');
    }
  } catch (error) {
    console.error(error);
    await interaction.reply(`❌ Fehler: ${error.message}`);
  }
}

async function handleHelpCommand(interaction) {
  const embed = new EmbedBuilder()
    .setColor('Green')
    .setTitle('📚 Bot Status Monitor - Help')
    .setDescription('Commands for the Status Monitor')
    .addFields(
      {
        name: '/status',
        value: 'Starts the Status Monitor with an embed that updates every 60 seconds.',
        inline: false,
      },
      {
        name: '/stop_status',
        value: 'Stops the monitor and deletes the embed.',
        inline: false,
      },
      {
        name: '/help_status',
        value: 'Shows this help message.',
        inline: false,
      },
    );

  await interaction.reply({ embeds: [embed] });
}

function getbotStatuses(guild) {
  const statuses = {};

  for (const botId of BOT_IDS) {
    const member = guild.members.cache.get(botId);

    if (member) {
      statuses[botId] = {
        name: member.user.username,
        status: member.presence?.status || 'offline',
        online: member.presence?.status !== 'offline' && member.presence?.status !== undefined,
      };
    } else {
      statuses[botId] = {
        name: `User ${botId}`,
        status: 'offline',
        online: false,
      };
    }
  }

  return statuses;
}

function createStatusEmbed(guild) {
  const statuses = getbotStatuses(guild);

  let onlineCount = 0;
  let offlineCount = 0;
  const onlineBots = [];
  const offlineBots = [];

  for (const botId of BOT_IDS) {
    const info = statuses[botId];
    
    if (info.online) {
      onlineCount++;
      onlineBots.push({
        name: `🟢 ${info.name}`,
        value: '▰▰▰▰▰',
        inline: true,
      });
    } else {
      offlineCount++;
      offlineBots.push({
        name: `🔴 ${info.name}`,
        value: '▱▱▱▱▱',
        inline: true,
      });
    }
  }

  // Bestimme Farbe basierend auf Online-Status
  const embedColor = offlineCount === 0 ? '#00AA00' : offlineCount === BOT_IDS.length ? '#CC0000' : '#FFA500';

  const now = new Date();
  const timeString = now.toLocaleTimeString('en-US', { hour12: false });
  const dateString = now.toLocaleDateString('en-US');

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle('🤖 Bot Status Monitor')
    .setDescription('Real-time bot availability monitoring')
    .setThumbnail('https://cdn.discordapp.com/emojis/823669826254151691.png');

  // Füge Online Bots hinzu (wenn es welche gibt)
  if (onlineBots.length > 0) {
    embed.addFields({
      name: `✅ Online (${onlineCount})`,
      value: '\u200B',
      inline: false,
    });
    
    // Teile Online-Bots in Gruppen von 3 auf
    for (let i = 0; i < onlineBots.length; i += 3) {
      const group = onlineBots.slice(i, i + 3);
      embed.addFields(...group);
    }
  }

  // Spacer
  embed.addFields({
    name: '\u200B',
    value: '\u200B',
    inline: false,
  });

  // Füge Offline Bots hinzu (wenn es welche gibt)
  if (offlineBots.length > 0) {
    embed.addFields({
      name: `❌ Offline (${offlineCount})`,
      value: '\u200B',
      inline: false,
    });
    
    // Teile Offline-Bots in Gruppen von 3 auf
    for (let i = 0; i < offlineBots.length; i += 3) {
      const group = offlineBots.slice(i, i + 3);
      embed.addFields(...group);
    }
  }

  // Summary Footer
  embed.addFields({
    name: '\u200B',
    value: '\u200B',
    inline: false,
  });

  embed.addFields({
    name: '📊 Status Summary',
    value: `🟢 **${onlineCount}/${BOT_IDS.length}** online`,
    inline: true,
  });

  if (offlineCount > 0) {
    embed.addFields({
      name: '⚠️ At Risk',
      value: `🔴 **${offlineCount}/${BOT_IDS.length}** offline`,
      inline: true,
    });
  }

  embed.setFooter({ text: `Last update: ${dateString} at ${timeString}` });

  return embed;
}

async function handleAddBotCommand(interaction) {
  try {
    const botId = interaction.options.getString('bot_id');

    // Validiere ob es eine gültige ID ist
    if (!/^\d+$/.test(botId)) {
      await interaction.reply('❌ Invalid bot ID! Please provide a valid numeric ID.');
      return;
    }

    // Prüfe ob Bot bereits in der Liste ist
    if (BOT_IDS.includes(botId)) {
      await interaction.reply(`❌ Bot ${botId} is already in the monitoring list!`);
      return;
    }

    // Verifiziere dass es sich um einen Bot handelt, nicht um einen User
    try {
      const user = await client.users.fetch(botId);
      if (!user.bot) {
        await interaction.reply('❌ This ID is a regular user account, not a bot! Only bot accounts can be monitored.');
        return;
      }
    } catch (fetchError) {
      await interaction.reply('❌ Could not verify the ID. Please check if it\'s a valid Discord user/bot ID.');
      return;
    }

    // Füge Bot hinzu
    BOT_IDS.push(botId);
    saveMonitoredBots();

    // Aktualisiere das Status-Embed wenn es existiert
    if (statusMessage && statusChannel) {
      try {
        const newEmbed = createStatusEmbed(interaction.guild);
        await statusMessage.edit({ embeds: [newEmbed] });
        console.log('📊 Status Embed updated after adding bot');
      } catch (error) {
        console.warn('⚠️  Could not update status embed:', error.message);
      }
    }

    await interaction.reply(`✅ Bot ${botId} added to monitoring list! Total bots: ${BOT_IDS.length}`);
  } catch (error) {
    console.error(error);
    await interaction.reply('❌ Error adding bot.');
  }
}

async function handleRemoveBotCommand(interaction) {
  try {
    const botId = interaction.options.getString('bot_id');

    // Prüfe ob Bot in der Liste ist
    if (!BOT_IDS.includes(botId)) {
      await interaction.reply(`❌ Bot ${botId} is not in the monitoring list!`);
      return;
    }

    // Entferne Bot
    BOT_IDS = BOT_IDS.filter(id => id !== botId);
    saveMonitoredBots();

    // Aktualisiere das Status-Embed wenn es existiert
    if (statusMessage && statusChannel) {
      try {
        const newEmbed = createStatusEmbed(interaction.guild);
        await statusMessage.edit({ embeds: [newEmbed] });
        console.log('📊 Status Embed updated after removing bot');
      } catch (error) {
        console.warn('⚠️  Could not update status embed:', error.message);
      }
    }

    await interaction.reply(`✅ Bot ${botId} removed from monitoring list! Total bots: ${BOT_IDS.length}`);
  } catch (error) {
    console.error(error);
    await interaction.reply('❌ Error removing bot.');
  }
}

async function handleListBotsCommand(interaction) {
  try {
    if (BOT_IDS.length === 0) {
      await interaction.reply('❌ No bots in the monitoring list!');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('Blue')
      .setTitle('📋 Monitored Bots')
      .setDescription(`Total: ${BOT_IDS.length} bots`)
      .addFields({
        name: 'Bot IDs',
        value: BOT_IDS.map((id, index) => `${index + 1}. \`${id}\``).join('\n'),
        inline: false,
      })
      .setFooter({ text: 'Use /add_bot or /remove_bot to manage' });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error(error);
    await interaction.reply('❌ Error listing bots.');
  }
}

client.login(process.env.DISCORD_TOKEN);
