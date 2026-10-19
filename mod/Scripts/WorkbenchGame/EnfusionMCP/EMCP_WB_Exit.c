/**
 * EMCP_WB_Exit.c - Close Workbench cleanly
 *
 * Optionally saves the open world, answers, then exits half a second later
 * (exiting inside the handler would drop the response).
 *
 * Called via NET API TCP protocol: APIFunc = "EMCP_WB_Exit"
 */

class EMCP_WB_ExitRequest : JsonApiStruct
{
	bool save;

	void EMCP_WB_ExitRequest()
	{
		RegV("save");
	}
}

class EMCP_WB_ExitResponse : JsonApiStruct
{
	string status;
	string message;
	bool saved;

	void EMCP_WB_ExitResponse()
	{
		RegV("status");
		RegV("message");
		RegV("saved");
	}
}

class EMCP_WB_Exit : NetApiHandler
{
	static void DoExit()
	{
		Workbench.Exit(0);
	}

	override JsonApiStruct GetRequest()
	{
		return new EMCP_WB_ExitRequest();
	}

	override JsonApiStruct GetResponse(JsonApiStruct request)
	{
		EMCP_WB_ExitRequest req = EMCP_WB_ExitRequest.Cast(request);
		EMCP_WB_ExitResponse resp = new EMCP_WB_ExitResponse();

		if (req.save)
		{
			WorldEditor worldEditor = Workbench.GetModule(WorldEditor);
			if (worldEditor)
				resp.saved = worldEditor.Save();
		}

		if (GetGame() && GetGame().GetCallqueue())
		{
			GetGame().GetCallqueue().CallLater(DoExit, 500);
			resp.message = "Workbench is exiting";
		}
		else
		{
			resp.message = "No call queue available; the client will close the process";
		}

		resp.status = "ok";
		return resp;
	}
}
