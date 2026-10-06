const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');

const migrationsDir=path.join(__dirname,'migrations');

function migrationFiles(){
  return fs.readdirSync(migrationsDir)
    .filter(file=>/^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();
}

function openDatabase(dataDir=path.join(__dirname,'.data')){
  fs.mkdirSync(dataDir,{recursive:true});
  const db=new DatabaseSync(path.join(dataDir,'contracts.sqlite'));
  db.exec('PRAGMA busy_timeout=5000;');
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const mark=db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)');
  try{
    for(const file of migrationFiles()){
      db.exec('BEGIN IMMEDIATE');
      try{
        const alreadyApplied=db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(file);
        if(!alreadyApplied){
          db.exec(fs.readFileSync(path.join(migrationsDir,file),'utf8'));
          mark.run(file,Date.now());
        }
        db.exec('COMMIT');
      }catch(error){
        db.exec('ROLLBACK');
        throw error;
      }
    }
  }catch(error){
    db.close();
    throw error;
  }
  return db;
}

module.exports={openDatabase,migrationFiles};
