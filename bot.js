const { Client, GatewayIntentBits, ChannelType, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
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

// User ID für Offline-Benachrichtigungen (aus .env)
const ALERT_USER_ID = process.env.ALERT_USER_ID;

// Persistierungs-Dateien
const CONFIG_FILE = path.join(__dirname, 'status-monitor-config.json');
const BOTS_FILE = path.join(__dirname, 'monitored-bots.json');

// In-Memory Storage für Server-spezifische Bot-IDs
let guildBots = {}; // { guildId: [botId1, botId2, ...] }

// Lade alle überwachten Bot-IDs pro Server
function loadMonitoredBots() {
  try {
    if (fs.existsSync(BOTS_FILE)) {
      const data = fs.readFileSync(BOTS_FILE, 'utf8');
      const loadedGuildBots = JSON.parse(data);
      if (typeof loadedGuildBots === 'object' && loadedGuildBots !== null) {
        guildBots = loadedGuildBots;
        const totalBots = Object.values(guildBots).reduce((sum, bots) => sum + bots.length, 0);
        console.log(`✅ ${totalBots} überwachte Bots aus ${Object.keys(guildBots).length} Servern geladen`);
      }
    }
  } catch (error) {
    console.error('Fehler beim Laden der Bot-IDs:', error);
  }
}

// Speichere alle überwachten Bot-IDs pro Server
function saveMonitoredBots() {
  try {
    fs.writeFileSync(BOTS_FILE, JSON.stringify(guildBots, null, 2));
    const totalBots = Object.values(guildBots).reduce((sum, bots) => sum + bots.length, 0);
    console.log(`💾 ${totalBots} Bot-IDs aus ${Object.keys(guildBots).length} Servern gespeichert`);
  } catch (error) {
    console.error('Fehler beim Speichern der Bot-IDs:', error);
  }
}

// Gibt die Bot-IDs für einen bestimmten Server zurück
function getGuildBots(guildId) {
  return guildBots[guildId] || [];
}

// Setzt die Bot-IDs für einen bestimmten Server
function setGuildBots(guildId, botIds) {
  guildBots[guildId] = botIds;
  saveMonitoredBots();
}

// Globale Variablen für das Embed - jetzt pro Guild
let guildStatusData = {}; // { guildId: { statusMessage, statusChannel, updateInterval, previousBotStatuses, alertedBots, botOfflineTimes } }

// Legacy Variablen für Rückwärtskompatibilität
let statusMessage = null;
let statusChannel = null;
let updateInterval = null;

// Globale Variablen für Status-Tracking
let previousBotStatuses = {};
let alertedBots = {}; // Verhindert mehrfache Alerts für den gleichen Bot
let botOfflineTimes = {}; // Speichert wann ein Bot offline ging

// Hilfsfunktion: Erhalte die Status-Daten für eine Guild
function getGuildStatusData(guildId) {
  if (!guildStatusData[guildId]) {
    guildStatusData[guildId] = {
      statusMessage: null,
      statusChannel: null,
      updateInterval: null,
      previousBotStatuses: {},
      alertedBots: {},
      botOfflineTimes: {}
    };
  }
  return guildStatusData[guildId];
}

// Lade gespeicherte Konfiguration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(data);
      
      // Rückwärtskompatibilität: Wenn altes Format (mit guildId, channelId, messageId)
      if (parsed.guildId && parsed.channelId && parsed.messageId && !Array.isArray(parsed)) {
        console.log('🔄 Konvertiere altes Config-Format zu neuem...');
        return {
          configs: [
            {
              guildId: parsed.guildId,
              channelId: parsed.channelId,
              messageId: parsed.messageId
            }
          ]
        };
      }
      
      // Neues Format: Array von Configs
      if (parsed.configs && Array.isArray(parsed.configs)) {
        return parsed;
      }
      
      console.warn('⚠️  Unbekanntes Config-Format');
      return null;
    }
  } catch (error) {
    console.error('Fehler beim Laden der Konfiguration:', error);
  }
  return null;
}

// Speichere Konfiguration für alle aktiven Guilds
function saveAllConfigs() {
  try {
    const configs = [];
    
    // Sammle alle aktiven Guild-Konfigurationen
    for (const guildId in guildStatusData) {
      const guildData = guildStatusData[guildId];
      if (guildData.statusMessage && guildData.statusChannel) {
        configs.push({
          guildId: guildId,
          channelId: guildData.statusChannel.id,
          messageId: guildData.statusMessage.id
        });
      }
    }
    
    if (configs.length > 0) {
      fs.writeFileSync(
        CONFIG_FILE,
        JSON.stringify({ configs }, null, 2)
      );
      console.log(`💾 ${configs.length} Guild-Konfiguration(en) gespeichert`);
    } else {
      // Wenn keine aktiven Monitore, lösche die Config-Datei
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
        console.log('🗑️  Config-Datei gelöscht (keine aktiven Monitore)');
      }
    }
  } catch (error) {
    console.error('Fehler beim Speichern der Konfigurationen:', error);
  }
}

// Alte Funktion: Speichere eine einzelne Konfiguration (wird durch saveAllConfigs ersetzt)
function saveConfig(channelId, messageId, guildId) {
  // Diese Funktion wird jetzt automatisch mit saveAllConfigs aufgerufen
  // Wir behalten sie für Legacy-Kompatibilität
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

// Lösche gespeicherte Konfiguration für spezifische Guild
function deleteConfigForGuild(guildId) {
  try {
    // Stoppe den Update Interval für diese Guild
    const guildData = getGuildStatusData(guildId);
    if (guildData.updateInterval) {
      clearInterval(guildData.updateInterval);
      guildData.updateInterval = null;
    }
    
    // Lösche die Daten für diese Guild
    delete guildStatusData[guildId];
    
    // Wenn nur eine Guild gespeichert war, lösche auch die Config-Datei
    if (fs.existsSync(CONFIG_FILE)) {
      const config = loadConfig();
      if (config && config.guildId === guildId) {
        deleteConfig();
      }
    }
    
    console.log(`🗑️  Konfiguration für Guild ${guildId} gelöscht`);
  } catch (error) {
    console.error('Fehler beim Löschen der Guild-Konfiguration:', error);
  }
}

client.once('ready', async () => {
  console.log(`✅ Bot ist online als ${client.user.tag}`);

  // Sync Commands
  try {
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
        .setDescription('Adds a bot to the monitoring list')
        .addStringOption(option =>
          option
            .setName('bot_id')
            .setDescription('The ID of the bot to add')
            .setRequired(true)
        ),

      new SlashCommandBuilder()
        .setName('remove_bot')
        .setDescription('Removes a bot from the monitoring list')
        .addStringOption(option =>
          option
            .setName('bot_id')
            .setDescription('The ID of the bot to remove')
            .setRequired(true)
        ),

      new SlashCommandBuilder()
        .setName('list_bots')
        .setDescription('Shows all monitored bots'),
    ].map((command) => command.toJSON());

    await client.application.commands.set(commands);
    console.log('🔄 Slash-Commands synchronisiert!');
  } catch (error) {
    console.error('❌ Fehler beim Synchronisieren der Commands:', error);
  }

  // Lade überwachte Bots
  loadMonitoredBots();

  // Versuche, den Status-Monitor nach einem Restart wiederherzustellen
  restoreStatusMonitor();
});

// Stelle den Status-Monitor wieder her, falls Konfigurationen gespeichert sind
async function restoreStatusMonitor() {
  try {
    const configData = loadConfig();
    if (!configData || !configData.configs || configData.configs.length === 0) {
      console.log('ℹ️  Keine gespeicherte Status-Monitor Konfiguration gefunden.');
      return;
    }

    console.log(`📝 ${configData.configs.length} gespeicherte Config(s) gefunden - stelle wieder her...`);

    // Versuche, alle gespeicherten Configs wiederherzustellen
    for (const config of configData.configs) {
      try {
        await restoreSingleStatusMonitor(config);
      } catch (error) {
        console.error(`❌ Fehler beim Wiederherstellen der Config für Guild ${config.guildId}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Fehler beim Wiederherstellen der Status-Monitore:', error.message);
  }
}

// Stelle einen einzelnen Status-Monitor wieder her
async function restoreSingleStatusMonitor(config) {
  console.log(`\n🔄 Stelle Monitor wieder her: Guild=${config.guildId}, Channel=${config.channelId}, Message=${config.messageId}`);

  const guild = await client.guilds.fetch(config.guildId);
  if (!guild) {
    console.error(`❌ Guild ${config.guildId} nicht gefunden.`);
    return;
  }

  console.log(`✓ Guild gefetcht: ${guild.name}`);

  const channel = await guild.channels.fetch(config.channelId);
  if (!channel) {
    console.error(`❌ Channel ${config.channelId} nicht gefunden.`);
    return;
  }

  console.log(`✓ Channel gefetcht: ${channel.name}`);

  const guildData = getGuildStatusData(guild.id);

  try {
    const message = await channel.messages.fetch(config.messageId);
    if (!message) {
      throw new Error('Nachricht nicht gefunden');
    }

    guildData.statusMessage = message;
    guildData.statusChannel = channel;

    console.log(`✅ Status-Monitor wiederhergestellt! Aktualisiere Embed in ${channel.name}`);

    // Starte das Update Interval für diese Guild
    startUpdateInterval(guild);
  } catch (messageError) {
    console.warn('⚠️  Alte Nachricht nicht auffindbar, erstelle neue...');
    console.warn(`Error Details: ${messageError.message}`);
    
    try {
      // Versuche alte Messages zu löschen
      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        
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
      
      // Erstelle eine neue Message
      const embed = createStatusEmbed(guild);
      guildData.statusMessage = await channel.send({ embeds: [embed] });
      guildData.statusChannel = channel;
      
      console.log(`✅ Neue Status-Monitor Nachricht erstellt!`);
      
      // Starte das Update Interval
      startUpdateInterval(guild);
      
      // Speichere alle Konfigurationen neu
      saveAllConfigs();
    } catch (createError) {
      console.error('❌ Fehler beim Erstellen einer neuen Message:', createError.message);
    }
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
  const guildData = getGuildStatusData(guild.id);
  
  // Initialisiere previousBotStatuses beim ersten Start
  if (Object.keys(guildData.previousBotStatuses).length === 0) {
    const statuses = getbotStatuses(guild);
    guildData.previousBotStatuses = JSON.parse(JSON.stringify(statuses));
    console.log(`✅ [Guild: ${guild.name}] Initiale Bot-Status gespeichert`);
  }

  // Stoppe alten Interval falls vorhanden
  if (guildData.updateInterval) {
    clearInterval(guildData.updateInterval);
    console.log(`⏸️  [Guild: ${guild.name}] Alter Update-Interval gestoppt`);
  }

  // Starte neuen Interval für diese Guild
  guildData.updateInterval = setInterval(async () => {
    try {
      if (guildData.statusMessage && guildData.statusChannel) {
        // Versuche Guild-Daten zu aktualisieren mit Timeout
        try {
          await Promise.race([
            guild.members.fetch(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Members fetch timeout')), 5000)
            )
          ]);
        } catch (fetchError) {
          console.warn(`⚠️  [Guild: ${guild.name}] Guild members fetch timeout - verwende Cache`);
          // Fallback: Nutze den Cache wenn fetch fehlschlägt
        }
        
        const statuses = getbotStatuses(guild);
        const BOT_IDS = getGuildBots(guild.id);
        
        // Prüfe auf Statusänderungen (Offline-Alerts)
        for (const botId of BOT_IDS) {
          const currentStatus = statuses[botId];
          const previousStatus = guildData.previousBotStatuses[botId];
          
          console.log(`[Guild: ${guild.name}] [Status Check] ${currentStatus.name}: vorher=${previousStatus?.online}, jetzt=${currentStatus.online}`);
          
          // Wenn Bot online war und jetzt offline ist (GLOBAL Alert-Flag verwenden!)
          if (previousStatus && previousStatus.online && !currentStatus.online && !alertedBots[botId]) {
            console.log(`⚠️  [Guild: ${guild.name}] Bot ${currentStatus.name} ist offline gegangen!`);
            alertedBots[botId] = true; // SOFORT setzen, BEVOR sendOfflineAlert aufgerufen wird!
            await sendOfflineAlert(currentStatus.name, botId);
          }
          
          // Wenn Bot offline war und jetzt wieder online ist (GLOBAL Alert-Flag verwenden!)
          if (previousStatus && !previousStatus.online && currentStatus.online && alertedBots[botId]) {
            console.log(`✅ [Guild: ${guild.name}] Bot ${currentStatus.name} ist wieder online!`);
            delete alertedBots[botId]; // SOFORT löschen, BEVOR sendOnlineAlert aufgerufen wird!
            await sendOnlineAlert(currentStatus.name, botId);
          }
        }
        
        // Speichere den aktuellen Status für den nächsten Check
        guildData.previousBotStatuses = JSON.parse(JSON.stringify(statuses));
        
        const newEmbed = createStatusEmbed(guild);
        await guildData.statusMessage.edit({ embeds: [newEmbed] });
        console.log(`📊 [Guild: ${guild.name}] Status Embed aktualisiert um ` + new Date().toLocaleTimeString('de-DE'));
      } else {
        console.warn(`⚠️  [Guild: ${guild.name}] statusMessage oder statusChannel ist null - Monitor läuft nicht`);
      }
    } catch (error) {
      console.error(`❌ [Guild: ${guild.name}] Fehler beim Aktualisieren des Embeds:`, error.message);
      
      // Stoppe nur beim Fehler, aber gib dem Benutzer eine Chance zu erkennen, was falsch ist
      if (error.code === 10008) {
        // Nachricht wurde gelöscht
        console.error(`📍 [Guild: ${guild.name}] Die Status-Monitor Nachricht wurde gelöscht. Monitor wird gestoppt.`);
        deleteConfigForGuild(guild.id);
        if (guildData.updateInterval) clearInterval(guildData.updateInterval);
      } else if (error.code === 50013) {
        // Fehlende Berechtigung
        console.error(`📍 [Guild: ${guild.name}] Fehlende Berechtigung zum Bearbeiten der Nachricht. Monitor wird gestoppt.`);
        deleteConfigForGuild(guild.id);
        if (guildData.updateInterval) clearInterval(guildData.updateInterval);
      }
      // Für andere Fehler: ignorieren und beim nächsten Durchlauf erneut versuchen
    }
  }, 60000); // 60 Sekunden

  console.log(`▶️  [Guild: ${guild.name}] Neuer Update-Interval gestartet`);
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
    const guildId = interaction.guild.id;
    const guildData = getGuildStatusData(guildId);
    
    guildData.statusChannel = interaction.channel;

    const embed = createStatusEmbed(interaction.guild);
    
    // Sende die Nachricht direkt in den Channel statt über Interaction
    // Das verhindert Webhook Token Fehler
    guildData.statusMessage = await guildData.statusChannel.send({ embeds: [embed] });

    // Starte das Update Interval für diese Guild
    startUpdateInterval(interaction.guild);
    
    // Speichere alle Konfigurationen (nicht nur diese)
    saveAllConfigs();

    // Sende eine Bestätigungsnachricht
    await interaction.reply('✅ Status Monitor started! The embed will be updated every 60 seconds.');
  } catch (error) {
    console.error(error);
    await interaction.reply('❌ Error starting the monitor.');
  }
}

async function handleStopStatusCommand(interaction) {
  try {
    const guildId = interaction.guild.id;
    const guildData = getGuildStatusData(guildId);
    
    if (guildData.statusMessage) {
      await guildData.statusMessage.delete();
      guildData.statusMessage = null;
      guildData.statusChannel = null;

      if (guildData.updateInterval) {
        clearInterval(guildData.updateInterval);
        guildData.updateInterval = null;
      }

      // Lösche die Daten für diese Guild
      delete guildStatusData[guildId];
      
      // Speichere alle verbleibenden Konfigurationen
      saveAllConfigs();

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
  const BOT_IDS = getGuildBots(guild.id);

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
  const BOT_IDS = getGuildBots(guild.id);

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

  // Wenn noch keine Bots hinzugefügt wurden
  if (BOT_IDS.length === 0) {
    embed.addFields({
      name: '📋 Keine Bots zum Überwachen',
      value: 'Verwende `/add_bot` um Bots hinzuzufügen',
      inline: false,
    });
  } else {
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
  }

  embed.setFooter({ text: `Last update: ${dateString} at ${timeString}` });

  return embed;
}

async function handleAddBotCommand(interaction) {
  try {
    const botId = interaction.options.getString('bot_id');
    const guildId = interaction.guild.id;
    let guildBotList = getGuildBots(guildId);

    // Validiere ob es eine gültige ID ist
    if (!/^\d+$/.test(botId)) {
      await interaction.reply('❌ Invalid bot ID! Please provide a valid numeric ID.');
      return;
    }

    // Prüfe ob Bot bereits in der Liste ist
    if (guildBotList.includes(botId)) {
      await interaction.reply(`❌ Bot ${botId} is already in the monitoring list for this server!`);
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
    guildBotList.push(botId);
    setGuildBots(guildId, guildBotList);

    // Aktualisiere das Status-Embed wenn es existiert
    const guildData = getGuildStatusData(guildId);
    if (guildData.statusMessage && guildData.statusChannel) {
      try {
        const newEmbed = createStatusEmbed(interaction.guild);
        await guildData.statusMessage.edit({ embeds: [newEmbed] });
        console.log(`📊 [Guild: ${interaction.guild.name}] Status Embed updated after adding bot`);
      } catch (error) {
        console.warn('⚠️  Could not update status embed:', error.message);
      }
    }

    await interaction.reply(`✅ Bot ${botId} added to monitoring list! Total bots: ${guildBotList.length}`);
  } catch (error) {
    console.error(error);
    await interaction.reply('❌ Error adding bot.');
  }
}

async function handleRemoveBotCommand(interaction) {
  try {
    const botId = interaction.options.getString('bot_id');
    const guildId = interaction.guild.id;
    let guildBotList = getGuildBots(guildId);

    // Prüfe ob Bot in der Liste ist
    if (!guildBotList.includes(botId)) {
      await interaction.reply(`❌ Bot ${botId} is not in the monitoring list for this server!`);
      return;
    }

    // Entferne Bot
    guildBotList = guildBotList.filter(id => id !== botId);
    setGuildBots(guildId, guildBotList);

    // Aktualisiere das Status-Embed wenn es existiert
    const guildData = getGuildStatusData(guildId);
    if (guildData.statusMessage && guildData.statusChannel) {
      try {
        const newEmbed = createStatusEmbed(interaction.guild);
        await guildData.statusMessage.edit({ embeds: [newEmbed] });
        console.log(`📊 [Guild: ${interaction.guild.name}] Status Embed updated after removing bot`);
      } catch (error) {
        console.warn('⚠️  Could not update status embed:', error.message);
      }
    }

    await interaction.reply(`✅ Bot ${botId} removed from monitoring list! Total bots: ${guildBotList.length}`);
  } catch (error) {
    console.error(error);
    await interaction.reply('❌ Error removing bot.');
  }
}

async function handleListBotsCommand(interaction) {
  try {
    const guildId = interaction.guild.id;
    const BOT_IDS = getGuildBots(guildId);

    if (BOT_IDS.length === 0) {
      await interaction.reply('❌ No bots in the monitoring list for this server! Use `/add_bot` to add some.');
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
