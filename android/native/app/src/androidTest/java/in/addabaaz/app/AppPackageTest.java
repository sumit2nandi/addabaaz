package in.addabaaz.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.security.NetworkSecurityPolicy;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Run on a connected emulator/device with connectedDebugAndroidTest. */
@RunWith(AndroidJUnit4.class)
public class AppPackageTest {
    @Test
    public void bundlesPublicAppOnly() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("in.addabaaz.app", context.getPackageName());
        assertFalse(NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted());
        List<String> files = Arrays.asList(context.getAssets().list("public"));
        assertTrue(files.contains("index.html"));
        assertTrue(files.contains("content.json"));
        assertFalse(files.contains("admin.html"));
        assertFalse(files.contains("data"));
        assertFalse(files.contains("website.xlsx"));
    }
}
