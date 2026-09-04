ALTER TABLE catalog_folders ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
CREATE INDEX catalog_folder_parent ON catalog_folders(parent_id);

-- A single function invocation owns the transaction, including on Hyperdrive's
-- per-query connection adapter. The tree-wide write lock prevents concurrent
-- A->B / B->A moves, and also serializes with any legacy folder INSERT.
CREATE FUNCTION catalog_save_folder(fid text, expected_revision integer, new_title text, new_parent text, actor text)
RETURNS catalog_folders LANGUAGE plpgsql AS $$
DECLARE result catalog_folders; parent_depth integer := 0; subtree_height integer := 1; bad_cycle boolean := false;
BEGIN
  IF fid IS NULL OR length(fid)=0 OR expected_revision IS NULL OR expected_revision<0
    OR new_title IS NULL OR length(btrim(new_title)) NOT BETWEEN 1 AND 180
    OR actor IS NULL OR length(actor)=0 THEN RAISE EXCEPTION 'Invalid folder input'; END IF;
  LOCK TABLE catalog_folders IN SHARE ROW EXCLUSIVE MODE;
  IF expected_revision=0 THEN
    IF EXISTS(SELECT 1 FROM catalog_folders WHERE id=fid) THEN RAISE EXCEPTION 'Folder already exists'; END IF;
    IF (SELECT count(*) FROM catalog_folders)>=5000 THEN RAISE EXCEPTION 'Folder manager supports up to 5000 folders'; END IF;
  ELSE
    SELECT * INTO result FROM catalog_folders WHERE id=fid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Folder unavailable'; END IF;
    IF result.revision<>expected_revision THEN RAISE EXCEPTION 'Folder changed. Reload before saving'; END IF;
  END IF;
  IF new_parent IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM catalog_folders WHERE id=new_parent) THEN RAISE EXCEPTION 'Parent folder unavailable'; END IF;
    WITH RECURSIVE ancestors AS (
      SELECT f.id,f.parent_id,1 AS depth,ARRAY[f.id] AS path,false AS cycle FROM catalog_folders f WHERE f.id=new_parent
      UNION ALL
      SELECT f.id,f.parent_id,a.depth+1,a.path||f.id,f.id=ANY(a.path)
        FROM ancestors a JOIN catalog_folders f ON f.id=a.parent_id WHERE NOT a.cycle AND a.depth<=8
    ) SELECT coalesce(max(depth),0),coalesce(bool_or(cycle OR id=fid),false) INTO parent_depth,bad_cycle FROM ancestors;
    IF bad_cycle THEN RAISE EXCEPTION 'A folder cannot be moved into itself or a descendant'; END IF;
  END IF;
  IF expected_revision>0 THEN
    WITH RECURSIVE descendants AS (
      SELECT f.id,1 AS depth,ARRAY[f.id] AS path,false AS cycle FROM catalog_folders f WHERE f.id=fid
      UNION ALL
      SELECT f.id,d.depth+1,d.path||f.id,f.id=ANY(d.path)
        FROM descendants d JOIN catalog_folders f ON f.parent_id=d.id WHERE NOT d.cycle AND d.depth<=8
    ) SELECT coalesce(max(depth),1),coalesce(bool_or(cycle),false) INTO subtree_height,bad_cycle FROM descendants;
    IF bad_cycle THEN RAISE EXCEPTION 'Folder hierarchy needs repair'; END IF;
  END IF;
  IF parent_depth+subtree_height>8 THEN RAISE EXCEPTION 'Folders can be nested at most 8 levels'; END IF;
  IF expected_revision=0 THEN
    INSERT INTO catalog_folders(id,parent_id,title) VALUES(fid,new_parent,btrim(new_title)) RETURNING * INTO result;
  ELSE
    UPDATE catalog_folders SET parent_id=new_parent,title=btrim(new_title),revision=revision+1
      WHERE id=fid AND revision=expected_revision RETURNING * INTO result;
  END IF;
  INSERT INTO catalog_audit(id,actor_id,action,target_id)
    VALUES(gen_random_uuid()::text,actor,CASE WHEN expected_revision=0 THEN 'folder.created' ELSE 'folder.updated' END,fid);
  RETURN result;
END $$;
